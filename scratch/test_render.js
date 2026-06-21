const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

async function runTest() {
  const htmlContent = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf-8');
  
  // Set up JSDOM with resources: "usable" to load styles/scripts if needed, or we just mock global fetch
  const dom = new JSDOM(htmlContent, {
    runScripts: "outside-only",
    url: "http://localhost/"
  });
  
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.sessionStorage = {
    getItem: () => null,
    setItem: () => null,
    removeItem: () => null
  };
  
  // Mock fetch
  global.fetch = async (url) => {
    if (url.includes('/api/godowns')) {
      return {
        json: async () => [
          { id: 'g1', name: 'Godown No 1', opBags: 500, opQty: 25.000 },
          { id: 'g2', name: 'Godown No 2', opBags: 300, opQty: 15.000 }
        ]
      };
    }
    if (url.includes('/api/entries')) {
      return {
        json: async () => [
          {
            id: 'e1',
            date: '2026-06-20',
            godownId: 'g1',
            particulers: 'Lorry 1',
            issBags: 100,
            issQty: 5.000,
            recvBags: 50,
            recvQty: 2.500,
            closBags: 450,
            closQty: 22.500,
            remarks: ''
          }
        ]
      };
    }
    return { json: async () => [] };
  };
  
  // Load and run app.js
  const appJsCode = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf-8');
  
  // Execute the script in JSDOM context
  dom.window.eval(`
    ${appJsCode}
    // Set user state
    state.user = { id: 'u_saroj', email: 'sarojkumar' };
    loadAppData().then(() => {
      showPage('dashboard');
    });
  `);
  
  // Wait a bit for async functions to complete
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Let's print out the dashboard page sections to see what is shown
  console.log("Dashboard - Godown table tbody html:");
  console.log(dom.window.document.getElementById('dash-gd-tbody').innerHTML);
  console.log("\nDashboard - Godown table tfoot html:");
  console.log(dom.window.document.querySelector('#page-dashboard table tfoot').innerHTML);
  
  console.log("\nDashboard - Recent entries tbody html:");
  console.log(dom.window.document.getElementById('recent-tbody').innerHTML);
  console.log("\nDashboard - Recent entries tfoot html:");
  console.log(dom.window.document.querySelector('#page-dashboard .card:nth-of-type(3) table tfoot').innerHTML);
}

runTest().catch(console.error);
