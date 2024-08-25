import fs from 'fs';
import readline from 'readline';
import { networkInterfaces } from 'os';
import { exec, spawn } from 'child_process';
import path from 'path';
import https from 'https';

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Promisify readline question
const question = (query) => new Promise((resolve) => rl.question(query, resolve));

// Get local IP address
const getLocalIp = () => {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
};

// Execute shell command with retry
const execCommandWithRetry = async (command, retries = 5, timeout = 120000) => {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`Executing: ${command}`);
      return await new Promise((resolve, reject) => {
        const childProcess = exec(command, { timeout }, (error, stdout, stderr) => {
          if (error) {
            reject(error);
          } else {
            resolve(stdout.trim());
          }
        });
        childProcess.stdout.pipe(process.stdout);
        childProcess.stderr.pipe(process.stderr);
      });
    } catch (error) {
      console.error(`Attempt ${i + 1} failed: ${error.message}`);
      if (i === retries - 1) throw error;
      console.log('Waiting 10 seconds before retrying...');
      await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds before retrying
    }
  }
};

// Install dependencies
const installDependencies = async () => {
  console.log('Installing dependencies...');
  try {
    // Update Termux packages
    await execCommandWithRetry('pkg update -y && pkg upgrade -y');
    
    // Install necessary system dependencies
    await execCommandWithRetry('pkg install -y nodejs wget mono');
    
    // Clean npm cache
    await execCommandWithRetry('npm cache clean --force');
    
    // Install npm dependencies individually
    const dependencies = [
      'express',
      'compression',
      'express-rate-limit',
      'localtunnel',
      'lokijs',
      'showdown',
      'dotenv',
      'axios',
      'xml2js'
    ];
    
    for (const dep of dependencies) {
      try {
        await execCommandWithRetry(`npm install ${dep} --no-bin-links`, 3, 180000);
      } catch (error) {
        console.warn(`Failed to install ${dep}, trying with --legacy-peer-deps`);
        await execCommandWithRetry(`npm install ${dep} --no-bin-links --legacy-peer-deps`, 3, 180000);
      }
    }
    
    console.log('Dependencies installed successfully.');
  } catch (error) {
    console.error('Error installing dependencies:', error);
    throw error;
  }
};

// Get latest Jackett Mono download URL
const getLatestJackettUrl = () => {
  return new Promise((resolve, reject) => {
    https.get('https://api.github.com/repos/Jackett/Jackett/releases/latest', {
      headers: { 'User-Agent': 'Jackettio-Setup' }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const asset = json.assets.find(asset => asset.name === 'Jackett.Binaries.Mono.tar.gz');
          if (asset) {
            resolve(asset.browser_download_url);
          } else {
            reject(new Error('Unable to find Jackett Mono download URL.'));
          }
        } catch (error) {
          reject(new Error('Error parsing GitHub API response: ' + error.message));
        }
      });
    }).on('error', (error) => reject(error));
  });
};

// Install Jackett
const installJackett = async () => {
  console.log('Installing Jackett with Mono...');
  try {
    // Check if Mono is installed
    try {
      await execCommandWithRetry('mono --version');
    } catch (error) {
      console.log('Mono is not installed. Installing Mono...');
      await execCommandWithRetry('pkg install mono -y');
    }

    // Get latest Jackett Mono URL
    const jackettUrl = await getLatestJackettUrl();
    console.log(`Downloading Jackett from: ${jackettUrl}`);
    const jackettTarball = 'Jackett.Binaries.Mono.tar.gz';
    await execCommandWithRetry(`wget ${jackettUrl} -O ${jackettTarball}`, 3, 300000); // 3 retries, 5 minutes timeout

    // Extract Jackett
    const jackettDir = path.join(process.env.HOME, 'jackett');
    await execCommandWithRetry(`mkdir -p ${jackettDir}`);
    await execCommandWithRetry(`tar -xzf ${jackettTarball} -C ${jackettDir} --strip-components=1`);

    // Clean up
    await execCommandWithRetry(`rm ${jackettTarball}`);

    console.log('Jackett installed successfully.');
    
    // Launch Jackett
    console.log('Launching Jackett...');
    const jackettProcess = spawn('mono', ['JackettConsole.exe'], { cwd: jackettDir });
    
    jackettProcess.stdout.on('data', (data) => {
      console.log(`Jackett output: ${data}`);
    });

    jackettProcess.stderr.on('data', (data) => {
      console.error(`Jackett error: ${data}`);
    });

    jackettProcess.on('close', (code) => {
      console.log(`Jackett process exited with code ${code}`);
    });

    // Wait for Jackett to start
    await new Promise(resolve => setTimeout(resolve, 10000)); // Increased wait time to 10 seconds

  } catch (error) {
    console.error('Error installing or launching Jackett:', error);
    throw error;
  }
};

// Update config file
const updateConfig = (configFile, key, value) => {
  if (value && value.trim() !== '') {
    // Match the key and capture the whole line
    const regex = new RegExp(`(${key}:\\s*)('(?:[^']*'|[^']*')'|process.env[^,]*|''|true|false|[0-9]*|null)`, 'i');
    // Replace with the new value, preserving the rest of the line
    return configFile.replace(regex, (match, p1) => {
      // Preserve the 'process.env' part if it exists
      if (match.includes('process.env')) {
        return `${p1}process.env.${key.toUpperCase()} || '${value}'`;
      }
      return `${p1}'${value}'`;
    });
  }
  return configFile;
};

// Function to start the server
const startServer = () => {
  console.log('Starting the server...');
  const serverProcess = spawn('node', [path.join('src', 'index.js')], {
    stdio: 'inherit', // Inherit stdio so that the output and errors are visible in the console
  });

  serverProcess.on('close', (code) => {
    console.log(`Server process exited with code ${code}`);
  });

  return serverProcess;
};

// Main script
const main = async () => {
  try {
    // Check if we're in the correct directory
    if (!fs.existsSync(path.join(process.cwd(), 'package.json'))) {
      throw new Error('Please run this script from the project root directory.');
    }

    // Install dependencies
    await installDependencies();

    // Install and launch Jackett
    await installJackett();

    // Get local IP
    const localIp = getLocalIp();
    console.log(`Your local IP address is: ${localIp}`);

    // Get user input for configuration
    const subdomain = await question('Optional: Specify a subdomain for localtunnel (press Enter to skip): ');
    const apiKey = await question('Optional: Enter your Jackett API key (press Enter to skip): ');
    const tmdbAccessToken = await question('Optional: Enter your TMDB access token (press Enter to skip): ');

    // Read config file
    const configPath = './src/lib/config.js';
    let configFile = fs.readFileSync(configPath, 'utf8');

    // Update config file only for non-empty values
    configFile = updateConfig(configFile, 'localTunnelSubdomain', subdomain);
    configFile = updateConfig(configFile, 'jackettApiKey', apiKey);
    configFile = updateConfig(configFile, 'tmdbAccessToken', tmdbAccessToken);

    // Save updated config file
    fs.writeFileSync(configPath, configFile, 'utf8');
    console.log('Configuration updated successfully.');

    // Start the server
    startServer();

    console.log('Setup completed successfully. You can now start the server manually.');
  } catch (err) {
    console.error('Error during setup:', err.message);
  } finally {
    rl.close();
  }
};

main();
