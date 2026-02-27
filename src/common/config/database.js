const mysql = require('think-model-mysql');

module.exports = {
    handle: mysql,
    database: process.env.MYSQL_DATABASE || 'hiolabsDB',
    prefix: 'hiolabs_',
    encoding: 'utf8mb4',
    host: process.env.MYSQL_HOST || 'mysql',
    port: process.env.MYSQL_PORT || '3306',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    dateStrings: true
};
