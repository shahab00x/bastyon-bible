import json

# Read the JSON file
with open('public/en_kjv.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# Extract all abbreviations
abbreviations = [book['abbrev'] for book in data]

print("All book abbreviations found in JSON:")
for abbrev in abbreviations:
    print(f"'{abbrev}': '{abbrev}'")

# Create mapping for multi-word books with numbers
mapping = {
    '1 Samuel': '1sa',
    '2 Samuel': '2sa',
    '1 Kings': '1ki',
    '2 Kings': '2ki',
    '1 Chronicles': '1ch',
    '2 Chronicles': '2ch',
    '1 Corinthians': '1co',
    '2 Corinthians': '2co',
    '1 Thessalonians': '1th',
    '2 Thessalonians': '2th',
    '1 Timothy': '1ti',
    '2 Timothy': '2ti',
    '1 Peter': '1pe',
    '2 Peter': '2pe',
    '1 John': '1jo',
    '2 John': '2jo',
    '3 John': '3jo'
}

print("\nActual abbreviations for multi-word books:")
for full_name, abbrev in mapping.items():
    if abbrev in abbreviations:
        print(f"'{abbrev}': '{full_name}'")
