const db = require('../config/db.config');
const bcrypt = require('bcryptjs');
const { exec } = require('child_process');
const path = require('path');
const dockerContainer = 'gcc-container'; 

exports.getLogin = (req, res) => {
    res.render('login', { message: '' });
};

// Handle login POST request
exports.postLogin = (req, res) => {
    const { username, password } = req.body;

    // Find user by username
    db.query('SELECT * FROM users WHERE username = ?', [username], (err, results) => {
        if (err) throw err;

        if (results.length > 0) {
            const user = results[0];

            // Compare password
            bcrypt.compare(password, user.password, (err, match) => {
                if (err) throw err;

                if (match) {
                    // Store user data in session
                    req.session.userId = user.id;
                    req.session.username = user.username;
                    req.session.role = user.role;
                    req.session.labpath = user.labpath;  // Store the user's labpath in the session

                    // Redirect to respective dashboard
                    if (user.role === 'student') {
                        return res.redirect('/dashboard/student');
                    } else if (user.role === 'faculty') {
                        return res.redirect('/dashboard/faculty');
                    } else if (user.role === 'admin') {
                        return res.redirect('/dashboard/admin');
                    }
                } else {
                    res.render('login', { message: 'Invalid Credentials' });
                }
            });
        } else {
            res.render('login', { message: 'User not found' });
        }
    });
};

// Logout function
exports.logout = (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
};

// Dashboard for student
exports.getStudentDashboard = (req, res) => {
    if (req.session.role !== 'student') {
        return res.redirect('/login');
    }
    res.render('dashboard/student', { username: req.session.username });
};

// Dashboard for faculty
exports.getFacultyDashboard = (req, res) => {
    if (req.session.role !== 'faculty') {
        return res.redirect('/login');
    }
    res.render('dashboard/faculty', { username: req.session.username });
};

// Dashboard for admin
exports.getAdminDashboard = (req, res) => {
    if (req.session.role !== 'admin') {
        return res.redirect('/login');
    }
    res.render('dashboard/admin', { username: req.session.username });
};

exports.getChangePassword = (req, res) => {
    res.render('change-password', { role: req.session.role, message: '' });
};

exports.postChangePassword = (req, res) => {
    const { 'current-password': currentPassword, 'new-password': newPassword, 'confirm-password': confirmPassword } = req.body;
    const userId = req.session.userId;

    if (newPassword !== confirmPassword) {
        return res.render('change-password', { role: req.session.role, message: 'New passwords do not match.' });
    }

    // Fetch user from DB
    db.query('SELECT * FROM users WHERE id = ?', [userId], (err, results) => {
        if (err) throw err;

        if (results.length > 0) {
            const user = results[0];

            // Compare current password
            bcrypt.compare(currentPassword, user.password, (err, match) => {
                if (err) throw err;

                if (match) {
                    // Hash the new password
                    bcrypt.hash(newPassword, 10, (err, hash) => {
                        if (err) throw err;

                        // Update the password in DB
                        db.query('UPDATE users SET password = ? WHERE id = ?', [hash, userId], (err, results) => {
                            if (err) throw err;
                            res.render('change-password', { role: req.session.role, message: 'Password successfully changed!' });
                        });
                    });
                } else {
                    res.render('change-password', { role: req.session.role, message: 'Current password is incorrect.' });
                }
            });
        }
    });
};
// Render the Manage Users page
exports.getManageUsers = (req, res) => {
    if (req.session.role !== 'admin') {
        return res.redirect('/login');
    }

    // Fetch all users from the database
    db.query('SELECT id, username, role , labpath FROM users', (err, results) => {
        if (err) throw err;
        res.render('admin/manage-users', { users: results, role: req.session.role });
    });
};

// Render Add User form
exports.getAddUser = (req, res) => {
    if (req.session.role !== 'admin') {
        return res.redirect('/login');
    }
    res.render('admin/add-user', { role: req.session.role, message: '' });
};

// Handle Add User form submission
exports.postAddUser = (req, res) => {
    const { username, password, role, labpath } = req.body;

    // Hash the password
    bcrypt.hash(password, 10, (err, hash) => {
        if (err) throw err;

        // Insert the new user into the database
        db.query('INSERT INTO users (username, password, role, labpath) VALUES (?, ?, ?, ?)', [username, hash, role, labpath], (err, result) => {
            if (err) throw err;

            // If the user is a student, create a folder inside the Docker container
            if (role === 'student') {
                const studentFolder = `/tmp/${username}`;  // Define the student folder path

                // Command to create the folder and set permissions inside the Docker container
                const createFolderCmd = `docker exec gcc-container bash -c "mkdir -p ${studentFolder} && chmod 777 ${studentFolder}"`;

                // Execute the command to create the folder
                exec(createFolderCmd, (err, stdout, stderr) => {
                    if (err) {
                        console.error('Error creating student folder in Docker:', stderr);
                        return res.status(500).send('Error creating student folder');
                    }
                    console.log(`Folder created for ${username} at ${studentFolder}`);
                    
                    // Redirect to manage users after successful creation
                    res.redirect('/admin/manage-users');
                });
            } else {
                // For non-student roles, just redirect after user creation
                res.redirect('/admin/manage-users');
            }
        });
    });
};
// Render Edit User form
exports.getEditUser = (req, res) => {
    const userId = req.params.id;

    // Fetch the user by ID
    db.query('SELECT id, username, role , labpath FROM users WHERE id = ?', [userId], (err, results) => {
        if (err) throw err;

        if (results.length > 0) {
            res.render('admin/edit-user', { user: results[0], role: req.session.role, message: '' });
        } else {
            res.redirect('/admin/manage-users');
        }
    });
};

// Handle Edit User form submission
exports.postEditUser = (req, res) => {
    const userId = req.params.id;
    const { username, role, labpath } = req.body;

    // First, retrieve the current username to check if it has changed
    db.query('SELECT username, role, labpath  FROM users WHERE id = ?', [userId], (err, results) => {
        if (err) throw err;

        const oldUsername = results[0].username;
        const oldRole = results[0].role;

        // Update the user's username, role, and labpath
        db.query('UPDATE users SET username = ?, role = ?, labpath = ? WHERE id = ?', [username, role, labpath, userId], (err, result) => {
            if (err) throw err;

            // If the role is student and the username has changed, rename the folder
            if (oldRole === 'student' && role === 'student' && oldUsername !== username) {
                const oldFolder = `/tmp/${oldUsername}`;
                const newFolder = `/tmp/${username}`;

                // Rename the folder inside the Docker container
                const renameFolderCmd = `docker exec gcc-container bash -c "mv ${oldFolder} ${newFolder}"`;

                exec(renameFolderCmd, (err, stdout, stderr) => {
                    if (err) {
                        console.error('Error renaming student folder in Docker:', stderr);
                        return res.status(500).send('Error renaming student folder');
                    }
                    console.log(`Folder renamed from ${oldFolder} to ${newFolder}`);
                    res.redirect('/admin/manage-users');
                });
            } else {
                // If no folder renaming is required, just redirect
                res.redirect('/admin/manage-users');
            }
        });
    });
};

// Handle Delete User
exports.postDeleteUser = (req, res) => {
    const userId = req.params.id;

    // First, retrieve the labpath of the user
    db.query('SELECT username, labpath, role FROM users WHERE id = ?', [userId], (err, results) => {
        if (err) throw err;

        if (results.length === 0) {
            return res.status(404).send('User not found');
        }

        const username = results[0].username;
        const labpath = results[0].labpath;
        const role = results[0].role;

        // Move the folder only if the user is a student
        if (role === 'student' && labpath) {
            const deletedDataFolder = `/tmp/deleteddata`;
            const studentFolder = `/tmp/${username}`;
            const moveCommand = `
                docker exec gcc-container bash -c "
                mkdir -p ${deletedDataFolder} && chmod 777 ${deletedDataFolder} &&
                mv ${studentFolder} ${deletedDataFolder}/${username}"
            `;

            // Execute the move command
            exec(moveCommand, (err, stdout, stderr) => {
                if (err) {
                    console.error('Error moving student folder to deleteddata:', stderr);
                    return res.status(500).send('Error moving student folder');
                }

                console.log(`Folder for ${username} moved to ${deletedDataFolder}`);

                // After successfully moving the folder, delete the user from the database
                db.query('DELETE FROM users WHERE id = ?', [userId], (err, result) => {
                    if (err) throw err;
                    res.redirect('/admin/manage-users');
                });
            });
        } else {
            // If the user is not a student, just delete them from the database
            db.query('DELETE FROM users WHERE id = ?', [userId], (err, result) => {
                if (err) throw err;
                res.redirect('/admin/manage-users');
            });
        }
    });
};

// Render the editor page
// exports.getEditorPage = (req, res) => {
//     if (!req.session.username) {
//         return res.redirect('/login');
//     }

//     res.render('editor', { 
//         username: req.session.username,
//         role: req.session.role
//     });
// };
exports.getPythonEditorPage = (req, res) => {
    if (!req.session.username) {
        return res.redirect('/login');
    }

    res.render('pythoneditor', { 
        username: req.session.username,
        role: req.session.role
    });
};
exports.getJavaEditorPage = (req, res) => {
    if (!req.session.username) {
        return res.redirect('/login');
    }

    res.render('javaeditor', { 
        username: req.session.username,
        role: req.session.role
    });
};

exports.getUserPrograms = (req, res) => {
    const userId = req.session.userId;

    const query = 'SELECT id, filename, labpath, datetime FROM code_data WHERE userId = ? ORDER BY datetime DESC';
    db.query(query, [userId], (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Failed to fetch programs.' });
        }

        res.render('user-programs', {
            programs: results,
            role: req.session.role
        });
    });
};
// auth.controller.js
exports.getEditProgram = (req, res) => {
    const programId = req.params.id;
    const userId = req.session.userId;

    const query = 'SELECT filename, labpath FROM code_data WHERE id = ? AND userId = ?';
    db.query(query, [programId, userId], (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Failed to fetch program.' });
        }

        if (results.length === 0) {
            return res.status(404).json({ error: 'Program not found or you do not have permission to edit this program.' });
        }

        const program = results[0];
        const filePath = path.join(program.labpath, program.filename);

        // Determine the language based on file extension
        let language = '';
        const ext = path.extname(program.filename).substring(1);
        switch (ext) {
            case 'c':
                language = 'c';
                break;
            case 'cpp':
                language = 'cpp';
                break;
            case 'py':
                language = 'python';
                break;
            case 'java':
                language = 'java';
                break;
            case 'js':
                language = 'javascript';
                break;
            case 'php':
                language = 'php';
                break;
            default:
                language = 'plaintext'; // default language
                break;
        }

        // Fetch the code from the Docker container
        const dockerCommand = `docker exec ${dockerContainer} cat ${filePath}`;
        exec(dockerCommand, (dockerErr, stdout, stderr) => {
            if (dockerErr) {
                console.error('Error fetching code from Docker:', stderr);
                return res.status(500).json({ error: 'Failed to fetch code from Docker container.' });
            }

            res.render('editor', {
                filename: program.filename,
                labpath: program.labpath,
                code: stdout,  // code fetched from Docker
                role: req.session.role,
                theme: req.session.theme || 'vs-dark',  // Default theme if not set
                language: language  // pass the determined language to the editor
            });
        });
    });
};

// auth.controller.js
// exports.getEditorPage = (req, res) => {
//     res.render('editor', {
//         filename: null, // No filename for a new program
//         labpath: null,  // No labpath for a new program
//         code: '',       // No code for a new program
//         language: 'c',  // Default language is 'C'
//         role: req.session.role
//     });
// };

// Render the editor page
// Render the editor page
exports.getEditorPage = (req, res) => {
    if (!req.session.username) {
        return res.redirect('/login');
    }

    // Determine if the request is for creating a new program or editing an existing one
    const isEditing = req.query.programId != null;

    if (isEditing) {
        // If editing an existing program, fetch the program details from the database
        const programId = req.query.programId;
        const userId = req.session.userId;

        const query = 'SELECT filename, labpath, code, language FROM code_data WHERE id = ? AND userId = ?';
        db.query(query, [programId, userId], (err, results) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Failed to fetch program.' });
            }

            if (results.length === 0) {
                return res.status(404).json({ error: 'Program not found or you do not have permission to edit this program.' });
            }

            const program = results[0];
            res.render('editor', {
                filename: program.filename, 
                labpath: program.labpath,
                code: program.code,
                language: program.language || 'c',  // Default to 'c' if no language is specified
                theme: req.session.theme || 'vs-dark',  // Default theme if not set
                role: req.session.role,
                username: req.session.username
            });
        });
    } else {
        // If creating a new program, render the editor with default values
        res.render('editor', {
            filename: null, // No filename for a new program
            labpath: null,  // No labpath for a new program
            code: '',       // No code for a new program
            language: 'c',  // Default language is 'C'
            theme: req.session.theme || 'vs-dark',  // Default theme if not set
            role: req.session.role,
            username: req.session.username
        });
    }
};

