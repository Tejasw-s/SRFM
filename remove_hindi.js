const fs = require('fs');

const html = fs.readFileSync('public/index.html', 'utf8');
const js = fs.readFileSync('public/js/app.js', 'utf8');

const match = js.match(/en: (\{[\s\S]*?\n  \})/);
if(match) {
  const enDict = new Function('return ' + match[1])();
  let newHtml = html;
  
  // Replace body class
  newHtml = newHtml.replace('<body class="dark-theme">', '<body class="light-theme">');
  // Replace html lang
  newHtml = newHtml.replace('<html lang="hi">', '<html lang="en">');
  // Replace title
  newHtml = newHtml.replace('<title>GodownAudit — गोदाम लेखा</title>', '<title>GodownAudit</title>');
  // Replace lang selector
  newHtml = newHtml.replace(/<div class="lang-selector">[\s\S]*?<\/div>/, '');

  for(const [key, value] of Object.entries(enDict)) {
    if(key === 'days' || key === 'empty-rec' || key === 'empty-gd') continue;
    
    // We want to replace text inside <tag ... id="key" ...>TEXT</tag>
    const regex = new RegExp(`(<[^>]*id="${key}"[^>]*>)[^<]*(<\/[^>]+>)`, 'g');
    newHtml = newHtml.replace(regex, (m, p1, p2) => {
      // Don't replace if it's an input placeholder in HTML directly
      return p1 + value + p2;
    });

    // Handle tags without children cleanly
    const regex2 = new RegExp(`(<[^>]*id="${key}"[^>]*>)\\s*[^<]*\\s*$`, 'gm');
    newHtml = newHtml.replace(regex2, (m, p1) => {
      if(m.includes('</')) return m; // Has closing tag
      return p1 + value;
    });
  }
  
  // Manually replace specific strings with SVGs or complex structure
  newHtml = newHtml.replace('लॉगिन करें', 'Log In');
  newHtml = newHtml.replace('⚡ TiDB Cloud Database द्वारा सुरक्षित', '⚡ Secured by TiDB Cloud Database');
  newHtml = newHtml.replace('बाहर', 'Logout');
  newHtml = newHtml.replace('डैशबोर्ड', 'Dashboard');
  newHtml = newHtml.replace('मेनू', 'MENU');
  
  fs.writeFileSync('public/index.html', newHtml);
  console.log('HTML updated');
}
