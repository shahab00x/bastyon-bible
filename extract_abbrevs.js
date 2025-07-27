// Script to extract all unique abbreviations from the Bible JSON
const fs = require('node:fs')
const path = require('node:path')

const jsonPath = path.join(__dirname, 'public', 'en_kjv.json')
const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))

const abbreviations = data.map(book => book.abbrev).sort()
console.log('All abbreviations:')
abbreviations.forEach(abbrev => console.log(abbrev))
