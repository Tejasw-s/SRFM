const fs = require('fs');

let js = fs.readFileSync('public/js/app.js', 'utf8');

// Replace state
js = js.replace(/lang: 'hi',\s*theme: 'dark'/, "theme: 'light'");

// Remove dict
js = js.replace(/\/\/ ===== TRANSLATION DICTIONARY =====[\s\S]*?\/\/ ===== TOAST UTILITY =====/, '// ===== TOAST UTILITY =====');

// Replace ternary expressions
js = js.replace(/state\.lang === 'hi' \? '[^']*' : ('[^']*')/g, '$1');
js = js.replace(/state\.lang === 'hi'\s*\?\s*'[^']*'\s*:\s*('[^']*')/g, '$1');
js = js.replace(/state\.lang === 'hi' \? dict\.hi\['[^']*'\] : (dict\.en\['[^']*'\])/g, '$1');

// Hardcode dict.en where used
js = js.replace(/dict\.en\['empty-rec'\]/g, "'No records match search parameters.'");
js = js.replace(/dict\.en\['empty-gd'\]/g, "'No godowns found. Please add a godown first.'");
js = js.replace(/state\.lang === 'hi' \? dict\.hi\.days\[[^\]]+\] : dict\.en\.days\[(.*?)\]/g, "['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][$1]");

// Remove setLang function entirely
js = js.replace(/\/\/ ===== MULTI-LANGUAGE ENGINE =====[\s\S]*?\/\/ ===== THEME TOGGLE \(LIGHT \/ DARK\) =====/, '// ===== THEME TOGGLE (LIGHT / DARK) =====');

// Remove setLang calls in loadAppData or initialization
js = js.replace(/setLang\('hi'\);\s*\/\/\s*Default Hindi/g, '');
js = js.replace(/setLang\('hi'\);/g, '');

fs.writeFileSync('public/js/app.js', js);
console.log('JS cleaned up');
