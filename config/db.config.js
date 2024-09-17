const mysql = require('mysql2');

const connection = mysql.createConnection({
    host: 'localhost',
    user: 'online_editor',  // Use your MySQL username
    password: '#Rama#2024???#@',  // Use your MySQL password
    database: 'online_editor'  // The database you created
});

connection.connect((err) => {
    if (err) throw err;
    console.log("Connected to MySQL database!");
});

module.exports = connection;
