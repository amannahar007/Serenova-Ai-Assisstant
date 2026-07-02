const fs = require('fs');
const path = require('path');

const TARGET_DIRS = [
  'frontend-react/src',
  'frontend-web',
  'backend-node',
  'backend',
  'functions'
];

const ROOT_FILES = [
  'README.md',
  'start.bat',
  'restart.bat',
  'Launch Divu AI.bat',
  'install_autostart.bat',
  'DEPLOYMENT.md'
];

function replaceInFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  let newContent = content;

  // Replace case variations
  newContent = newContent.replace(/Divu AI Assistant/g, 'SERENOVA');
  newContent = newContent.replace(/Divu AI/g, 'SERENOVA');
  newContent = newContent.replace(/Divu/g, 'SERENOVA');
  newContent = newContent.replace(/divu/g, 'serenova');
  
  if (content !== newContent) {
    fs.writeFileSync(filePath, newContent, 'utf8');
    console.log(`Updated ${filePath}`);
  }
}

function walkDir(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'build', '.venv', '__pycache__'].includes(file)) continue;
      walkDir(fullPath);
    } else {
      if (['.js', '.jsx', '.json', '.html', '.css', '.md', '.py', '.bat'].includes(path.extname(file))) {
        replaceInFile(fullPath);
      }
    }
  }
}

TARGET_DIRS.forEach(dir => walkDir(path.join(__dirname, dir)));
ROOT_FILES.forEach(file => replaceInFile(path.join(__dirname, file)));

// Rename batch file if it exists
const oldBat = path.join(__dirname, 'Launch Divu AI.bat');
const newBat = path.join(__dirname, 'Launch SERENOVA.bat');
if (fs.existsSync(oldBat)) {
  fs.renameSync(oldBat, newBat);
  console.log(`Renamed bat file`);
}
