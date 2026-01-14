# Shape Logo Integration Guide

## Overview

Shape logos have been analyzed and integrated into the automated token launch system. Each shape logo has been color-coded and categorized for quick lookup during logo generation.

## Analysis Results

- **Total Logos Analyzed**: 60 shape logos
- **Metadata File**: `image/logo-library/shape-logos/shape-logos-metadata.json`

### Color Distribution

- **gray-medium**: 26 logos
- **blue-medium**: 8 logos
- **cyan-medium**: 8 logos
- **orange-medium**: 7 logos
- **brown-medium**: 5 logos
- **purple-medium**: 2 logos
- **red-medium**: 1 logo
- **black-dark**: 1 logo
- **brown-dark**: 1 logo
- **silver-bright**: 1 logo

## How It Works

### Logo Selection Priority

1. **Alphabet Logos** (First Priority)
   - Based on first letter of token name
   - Example: "Fun Token" → uses `f.png` from Alphabet folder

2. **Shape Logos** (Second Priority)
   - Selected based on color scheme preference
   - Automatically matches color scheme (purple, blue, orange, etc.)
   - Falls back to random shape logo if no color match

3. **Icon Fallback** (Third Priority)
   - Uses keyword-based icon selection
   - SVG icons with colorization

### Color Scheme Mapping

The system maps color schemes to shape logo colors:

- `purple` → purple shape logos
- `blue` → blue shape logos
- `green` → green shape logos
- `red` → red shape logos
- `orange` → orange shape logos
- `pink` → pink shape logos
- `cyan` → cyan shape logos
- `yellow` → yellow shape logos
- `gold` → gold shape logos

### Metadata Structure

Each shape logo has the following metadata:

```json
{
  "filename": "logo.png",
  "dimensions": {
    "width": 104,
    "height": 104,
    "isSquare": true
  },
  "colors": {
    "primary": {
      "r": 160,
      "g": 160,
      "b": 128,
      "hex": "#a0a080",
      "name": "gray"
    },
    "secondary": {...},
    "accent": {...}
  },
  "brightness": {
    "average": 128,
    "level": "medium"
  },
  "transparency": {
    "transparencyPercent": "10.5",
    "isTransparent": true
  },
  "primaryColor": "gray",
  "primaryHex": "#a0a080",
  "brightnessLevel": "medium",
  "isTransparent": true
}
```

## Usage in Branding Generator

### Automatic Selection

Shape logos are automatically used when:
- No alphabet logo exists for the token name's first letter
- A color scheme is specified that matches available shape logos

### Manual Selection

You can also manually get shape logos by color:

```javascript
const branding = new BrandingGenerator();

// Get shape logo by color
const shapeLogo = branding.getShapeLogoByColor('blue', 'medium');

// Get all shape logos matching criteria
const blueLogos = branding.getShapeLogosByCriteria({ color: 'blue', brightness: 'medium' });
```

## Re-analyzing Shape Logos

If you add new shape logos, run the analysis script:

```bash
node scripts/analyze-shape-logos.js
```

This will:
1. Analyze all PNG files in `image/logo-library/shape-logos/`
2. Extract dominant colors, brightness, and transparency
3. Generate/update `shape-logos-metadata.json`
4. Display a color summary

## Benefits

1. **Quick Lookup**: No need to analyze logos at runtime - metadata is pre-computed
2. **Color Matching**: Automatically selects shape logos that match the token's color scheme
3. **Fallback System**: Ensures a logo is always available (alphabet → shape → icon)
4. **Consistent Branding**: Shape logos maintain color consistency with the overall design

## Integration Points

- **Token Logo Generation**: Uses shape logos when alphabet logos unavailable
- **Website Logo Generation**: (Can be extended)
- **Twitter Banner Generation**: (Can be extended)

## Notes

- Shape logos are analyzed once and cached in metadata JSON
- The system prefers medium brightness logos for better visibility
- Transparent logos are supported and handled correctly
- All shape logos are square (104x104px) for consistency
