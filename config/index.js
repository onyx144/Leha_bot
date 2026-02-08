require('dotenv').config();

module.exports = {
  botToken: process.env.BOT_TOKEN,
  openaiApiKey: process.env.OPENAI_API_KEY,
  db: {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4',
  },
  paths: {
    chatMemory: require('path').join(__dirname, '..', 'data', 'chat_memory'),
    prompts: require('path').join(__dirname, '..', 'prompts'),
    logs: require('path').join(__dirname, '..', 'data', 'logs'),
  },
  chatMemoryMaxLines: 28,
};
