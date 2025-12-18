# ChainCraft Schema Documentation

This directory contains schema definitions for the UX DSL architecture.

## Schema Files

### Gamepiece Metadata

**Purpose**: Defines the structure for gamepiece metadata produced by the Metadata Extractor.

**Files**:
- `gamepiece-metadata.xml` - Example XML format (LLM output format)
- `gamepiece-metadata.schema.json` - JSON Schema (internal representation)

**Workflow**:
1. **LLM produces XML** using `gamepiece-metadata.xml` as template
2. **Parser converts to JSON** validating against `gamepiece-metadata.schema.json`
3. **Downstream components consume JSON**

**Why XML for LLM output?**
- Better handling of multi-line text (no escaping needed)
- Self-documenting tags reduce errors
- LLMs heavily trained on HTML/XML patterns
- Whitespace-insensitive (indentation doesn't break parsing)
- Clear structure with opening/closing tags

**Why JSON for internal use?**
- Standard format for JavaScript/TypeScript
- Easy validation with JSON Schema
- Native support in all tools
- Efficient parsing and manipulation

## Format Conversion

### XML to JSON Mapping

```xml
<!-- XML (LLM Output) -->
<gamepiece_type>
  <id>fire_drake</id>
  <name>Fire Drake</name>
  <brief_description>
    A fierce dragon that breathes fire.
    Multi-line text works naturally.
  </brief_description>
</gamepiece_type>
```

```json
// JSON (Internal Representation)
{
  "id": "fire_drake",
  "name": "Fire Drake",
  "brief_description": "A fierce dragon that breathes fire.\nMulti-line text works naturally."
}
```

## Schema Evolution

### Version 1.0 (Current)
- Gamepiece metadata with instance skeletons
- Support for templates
- Content expansion flags
- Generation hints

### Future Versions
- Nested inventories (gamepieces containing gamepieces)
- Conditional properties
- Asset references
- Localization support

## Usage Examples

See the XML example files for concrete examples of:
- Simple games (Rock Paper Scissors)
- Standard templates (Poker deck)
- Complex games (Fantasy card game with 150+ unique cards)
- Token-based games

## Validation

All JSON output is validated against the JSON Schema before being passed to downstream components. This ensures:
- Required fields are present
- IDs follow naming conventions
- Quantities match instance counts
- Data types are correct
