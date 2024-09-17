const express = require('express');
const session = require('express-session');
const { exec } = require('child_process');
const path = require('path');
const WebSocket = require('ws');
const pty = require('node-pty');
const bodyParser = require('body-parser');
const fs = require('fs');
const http = require('http');
const MemoryStore = require('memorystore')(session);
const dockerContainer = 'gcc-container'; 
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });
const db = require('./config/db.config');  // Import the database configuration
const port = 3001;

// Session Middleware
const sessionMiddleware = session({
    secret: 'secretkey',
    resave: false,
    saveUninitialized: true,
    store: new MemoryStore({ checkPeriod: 86400000 }),
    cookie: { secure: false }
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(bodyParser.json());
app.use(express.static('public'));
app.use(sessionMiddleware);

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Routes for authentication and other functionalities
app.use('/', require('./routes/auth.routes'));
// Helper function to parse session in WebSocket
function parseSession(socket, next) {
    sessionMiddleware(socket.upgradeReq, {}, next);
}

app.post('/save', (req, res) => {
    const code = req.body.code;
    const fileName = req.body.fileName || 'program.c';  // Default file name for C program
    const labpath = req.session.labpath ? `/tmp/${req.session.labpath}` : '/tmp';
    const userId = req.session.userId;  // Assuming userId is stored in session
    req.session.fileName = req.body.fileName || 'program.c'; 

    try {
        // Ensure the local tmp directory exists
        if (!fs.existsSync('./tmp')) {
            fs.mkdirSync('./tmp');
        }

        // Save the code to a local file
        const filePath = path.join('./tmp', fileName);
        fs.writeFileSync(filePath, code);

        // Copy the file to the Docker container's labpath
        const copyCommand = `docker cp ${filePath} ${dockerContainer}:${labpath}/${fileName}`;
        exec(copyCommand, (err, stdout, stderr) => {
            if (err) {
                console.error('Error copying file to Docker:', stderr);
                return res.status(500).json({ error: 'Failed to save file inside Docker container.' });
            }

            // Save or update code details in the MySQL database (code_data table)
            const query = `
                INSERT INTO code_data (filename, labpath, code, userId) 
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE code = ?, labpath = ?`;

            db.query(query, [fileName, labpath, code, userId, code, labpath], (err, result) => {
                if (err) {
                    console.error('Error saving code data to database:', err);
                    return res.status(500).json({ error: 'Failed to save code data to database.' });
                }

                let message = '';

                // New file created
                if (result.affectedRows === 1 && result.insertId) {
                    message = `New file created as ${fileName} in the ${labpath} directory inside the Docker container. Inserted record ID: ${result.insertId}`;
                } 
                // File updated
                else if (result.affectedRows === 2) {
                    message = `File updated as ${fileName} in the ${labpath} directory inside the Docker container.`;
                } 
                // No changes were made
                else if (result.affectedRows === 0) {
                    message = `No changes were made to the file ${fileName}. The contents are identical to the previous save.`;
                }

                res.json({
                    success: message,
                    databaseEntry: result.insertId || null // Return the ID of the inserted row, if any
                });
            });
        });
    } catch (error) {
        console.error('Error during file save operation:', error);
        res.status(500).json({ error: 'Failed to save file.' });
    }
});



// Endpoint to execute the C program directly
app.post('/compile-run', (req, res) => {
    const { fileName } = req.body;
    const labpath = req.session.labpath ? `/tmp/${req.session.labpath}` : '/tmp';  // Pull labpath from session
    const filePath = `${labpath}/${fileName}`;  // C file path inside the container
    cExecutable = fileName.replace('.c', '');  // Extract class name from file name
    // Save the fileName to the session so WebSocket can use it
    req.session.cExecutable = cExecutable;
    console.log(`Compiling C program: ${filePath}`);

    // Command to compile the C program inside the Docker container
    const compileCmd = `docker exec ${dockerContainer} bash -c "cd ${labpath} && gcc ${fileName} -o ${cExecutable}"`;

    // Execute the compilation command
    exec(compileCmd, (error, stdout, stderr) => {
        if (error) {
            console.error(`Compilation error: ${stderr}`);
            return res.json({ error: stderr });
        }

        console.log(`C program ${fileName} compiled successfully.`);

        // Send success response to initiate WebSocket communication for C program execution
        res.json({ success: true, message: `C program ${fileName} compiled successfully and is ready to run.` });
    });
});

// WebSocket server upgrade handling
server.on('upgrade', (req, socket, head) => {
    sessionMiddleware(req, {}, () => {
        wss.handleUpgrade(req, socket, head, (ws) => {
            // console.log(`The labpath is ${req.session.labpath}`);
            // console.log(`before connection The file Name is ${req.session.fileName}`);
           

            wss.emit('connection', ws, req);
        });
    });
});

// Handle WebSocket connections for interactive terminals
// Handle WebSocket connections for interactive terminals
wss.on('connection', (ws, req) => {
    console.log('WebSocket connection established.');
    const labpath = req.session.labpath ? `/tmp/${req.session.labpath}` : '/tmp';  // Use labpath from session
    const cExecutable = req.session.cExecutable ? `./${req.session.cExecutable}` : './program';
    const dockerCmd = `docker exec -it ${dockerContainer} bash -c "cd ${labpath} && ${cExecutable}"`;
    console.log(dockerCmd);

    // Spawn a Docker exec command that runs the C program interactively
    const shell = pty.spawn('bash', ['-c', dockerCmd], {
        name: 'xterm-color',
        cols: 80,
        rows: 14,
        cwd: process.env.HOME,
        env: process.env
    });

    // Set a timeout for the shell process
    const executionTimeout = 20000; // 10 seconds
    const timeout = setTimeout(() => {
        console.log('Program execution time exceeded. Terminating the process.');
        shell.kill();  // Kill the C process if it exceeds the time limit
        ws.send('\r\nProgram terminated due to timeout.\r\n');
        ws.close();  // Close the WebSocket connection
    }, executionTimeout);

    // Send output from the C program to the WebSocket
    shell.on('data', (data) => {
        ws.send(data);  // Forward the output to the client-side terminal
    });

    // Receive input from WebSocket and send it to the running C program
    ws.on('message', (msg) => {
        shell.write(msg);  // Forward input to the C process inside the Docker container
    });

    // Clean up when WebSocket connection closes
    ws.on('close', () => {
        console.log('WebSocket connection closed.');
        clearTimeout(timeout);  // Clear the timeout if the process finishes in time
        shell.kill();  // Ensure the C process is killed when WebSocket closes
    });
});

// Start the server
// server.listen(port, () => {
//     console.log(`Server running on http://localhost:${port}`);
// });
// Start the server and listen on all network interfaces
server.listen(port, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${port}`);
});