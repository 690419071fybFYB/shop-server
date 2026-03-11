const Application = require('thinkjs');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

function loadEnvFiles(env) {
  const cwd = process.cwd();
  const files = env === 'production' ? ['.env'] : ['.env.local', '.env'];
  files.forEach((filename) => {
    const filePath = path.join(cwd, filename);
    if (fs.existsSync(filePath)) {
      dotenv.config({ path: filePath });
    }
  });
}

module.exports = function bootThinkJS(env) {
  loadEnvFiles(env);
  const instance = new Application({
    ROOT_PATH: path.resolve(__dirname),
    env,
    proxy: true
  });

  instance.run();
};
