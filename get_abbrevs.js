const fs = require('node:fs')
const path = require('node:path')

const jsonPath = path.join(__dirname, 'public', 'en_kjv.json')

// Read the file content directly
const fileContent = fs.readFileSync(jsonPath, 'utf8')

// Parse the JSON
const data = JSON.parse(fileContent)

// Extract all abbreviations
const abbreviations = data.map(book => book.abbrev)

console.log('All book abbreviations found in JSON:')
abbreviations.forEach(abbrev => console.log(abbrev))

// Also create a mapping for verification
const mapping = {}
abbreviations.forEach((abbrev) => {
  mapping[abbrev] = abbrev // We'll replace this with actual full names
})

console.log('\nMapping object for bookNames:')
console.log(JSON.stringify(mapping, null, 2))
