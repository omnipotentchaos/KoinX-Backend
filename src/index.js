const app = require('./app');
const connectDB = require('./config/db');
require('dotenv').config();

const PORT = process.env.PORT || 3000;

// Initialize Database Connection
connectDB().then(() => {
  // Start HTTP Server Listener
  app.listen(PORT, () => {
    console.log(`Reconciliation Engine running in production mode`);
    console.log(`Server listening on port: http://localhost:${PORT}`);
  });
}).catch((err) => {
  console.error(`Failed to launch server: ${err.message}`);
  process.exit(1);
});
