# Scryfall MCP Server

A Model Context Protocol (MCP) server that provides advanced Magic: The Gathering card data retrieval and search capabilities using the Scryfall API and EDHREC resources.

## Overview

This MCP server acts as a bridge between MCP-compatible clients (like Claude Desktop, Cline, or other AI assistants) and Magic: The Gathering card databases. It provides intelligent caching, rate limiting, and comprehensive card data including rulings and similar card recommendations from EDHREC.

## Features

- **🃏 Card Data Retrieval**: Fetch comprehensive information about Magic: The Gathering cards using fuzzy name matching
- **🔍 Advanced Card Search**: Use Scryfall's powerful search syntax to find cards with complex queries
- **💾 Intelligent Caching**: Local caching system to reduce API calls and improve performance
- **📋 Rulings Integration**: Optional inclusion of official card rulings from Scryfall
- **🎯 Similar Card Recommendations**: Integration with EDHREC to suggest similar cards for deck building
- **⚡ Rate Limiting**: Respectful API usage with built-in rate limiting (75ms between requests)

## Prerequisites

### System Requirements

- **Deno Runtime**: Version 1.40+ (with `--unstable-temporal` support)
- **Operating System**: Linux, macOS, or Windows
- **Network Access**: Required for API calls to Scryfall and EDHREC

### Installing Deno

If you don't have Deno installed:

**Linux/macOS:**
```bash
curl -fsSL https://deno.land/install.sh | sh
```

**Windows (PowerShell):**
Ai generated; proceed with caution. 
```powershell
irm https://deno.land/install.ps1 | iex
```

**Package Managers:**
```bash
# macOS with Homebrew
brew install deno

# Ubuntu/Debian
sudo snap install deno

# Arch Linux
pacman -S deno
```

Verify installation:
```bash
deno --version
```

## Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
cd scryfall-mcp-server
```

### 2. Test the Server

Verify the server works correctly:

```bash
deno run --allow-net --allow-read --allow-write --allow-env --unstable-temporal main.ts
```

The server should start and display:
```
Scryfall MCP server running on stdio
```

Press `Ctrl+C` to stop the test.

### 3. Set Up Cache Directory

The server automatically creates a cache directory at `~/.scryfall-mcp-cache` on first run. You can verify this:

```bash
ls -la ~/.scryfall-mcp-cache
```

## MCP Client Configuration
You should actually look this up, this may not be accurate
### Claude Desktop

Add the following to your Claude Desktop configuration file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "scryfall": {
      "command": "deno",
      "args": [
        "run",
        "--allow-net",
        "--allow-read",
        "--allow-write",
        "--allow-env",
        "--unstable-temporal",
        "/absolute/path/to/scryfall-mcp-server/main.ts"
      ]
    }
  }
}
```

### Cline (VSCode Extension)

Add to your Cline MCP settings or `.vscode/mcp.json`:

```json
{
  "mcpServers": {
    "scryfall": {
      "command": "deno",
      "args": [
        "run",
        "--allow-net",
        "--allow-read",
        "--allow-write",
        "--allow-env",
        "--unstable-temporal",
        "/absolute/path/to/scryfall-mcp/main.ts"
      ]
    }
  }
}
```

### Other MCP Clients

For any MCP-compatible client, use these connection parameters:

- **Command**: `deno`
- **Arguments**: 
  - `run`
  - `--allow-net` (for API calls)
  - `--allow-read` (for cache reading)
  - `--allow-write` (for cache writing)
  - `--allow-env` (for environment variables like HOME)
  - `--unstable-temporal` (for modern date/time handling)
  - `/absolute/path/to/main.ts`

**⚠️ Important**: Replace `/absolute/path/to/scryfall-mcp/main.ts` with the actual absolute path to your `main.ts` file.

## Tools Reference

### 1. get_card_data

Retrieve detailed information about specific Magic: The Gathering cards.

#### Parameters
- `card_names` (required): Array of card names to fetch
- `include_rulings` (optional, default: false): Include official card rulings
- `include_similar_cards` (optional, default: false): Include EDHREC similar card recommendations

#### Example Usage
```json
{
  "card_names": ["Lightning Bolt", "Counterspell"],
  "include_rulings": true,
  "include_similar_cards": true
}
```

#### Response Format
```json
[
  {
    "name": "Lightning Bolt",
    "mana_cost": "{R}",
    "type_line": "Instant",
    "oracle_text": "Lightning Bolt deals 3 damage to any target.",
    "cmc": 1,
    "colors": ["R"],
    "legalities": {
      "standard": "not_legal",
      "modern": "legal",
      "commander": "legal"
    },
    "rulings": [...],
    "similar_cards": [...]
  }
]
```

### 2. search_cards

Search for Magic: The Gathering cards using Scryfall's advanced search syntax.

#### Parameters
- `query` (required): Scryfall search query
- `max_results` (optional, default: 25, max: 175): Maximum number of results
- `unique` (optional, default: 'cards'): How to handle duplicates ('cards', 'art', 'prints')
- `order` (optional, default: 'name'): Sort order
- `include_extras` (optional, default: false): Include tokens and planes

#### Search Query Examples

| Query | Description |
|-------|-------------|
| `o:"create" o:"token"` | Cards that create tokens |
| `t:equipment` | All equipment cards |
| `c:red pow>=4` | Red creatures with power 4+ |
| `o:flying t:creature` | Flying creatures |
| `f:commander` | Commander-legal cards |
| `s:dom` | Cards from Dominaria set |
| `r:mythic` | Mythic rare cards |
| `cmc=3` | Cards with converted mana cost 3 |

#### Advanced Search Syntax

- **Oracle Text**: `o:"text"` or `oracle:"text"`
- **Type Line**: `t:creature` or `type:artifact`
- **Colors**: `c:red` or `color:blue`
- **Mana Cost**: `m:{2}{R}` or `mana:{U}{U}`
- **Power/Toughness**: `pow>=4`, `tou<=2`
- **Rarity**: `r:common`, `r:uncommon`, `r:rare`, `r:mythic`
- **Set**: `s:dom` (set code) or `set:"Dominaria"`
- **Format Legality**: `f:standard`, `f:modern`, `f:commander`
- **Converted Mana Cost**: `cmc=3`, `cmc>=5`

For complete syntax reference, see: https://scryfall.com/docs/syntax

## Cache Management

### Cache Location
- **Linux/macOS**: `~/.scryfall-mcp-cache/`
- **Windows**: `%USERPROFILE%\.scryfall-mcp-cache\`

### Cache Structure
```
~/.scryfall-mcp-cache/
├── similar/                    # EDHREC similar cards cache
│   └── card-name.json         # Cached for 1 year
└── card-name.json             # Individual card cache
```

### Cache Maintenance

**View cache size:**
```bash
du -sh ~/.scryfall-mcp-cache
```

**Clear all cache:**
```bash
rm -rf ~/.scryfall-mcp-cache
```

**Clear only similar cards cache:**
```bash
rm -rf ~/.scryfall-mcp-cache/similar
```

## Development

### Running Tests

```bash
deno test --allow-net --allow-read --allow-write --allow-env --unstable-temporal
```

### Code Structure

- `main.ts` - Main MCP server implementation and API client
- `model.ts` - TypeScript interfaces for EDHREC API responses
- `deno.json` - Deno configuration and dependencies

### Key Components

1. **ScryfallClient**: Handles API communication with rate limiting
2. **Cache Management**: File-based caching with TTL for similar cards
3. **MCP Server**: Protocol implementation with tool handlers
4. **Rate Limiting**: 75ms delay between API requests

## Troubleshooting

### Common Issues

**"Permission denied" errors:**
- Ensure all required Deno permissions are granted
- Check that the cache directory is writable

**"Module not found" errors:**
- Verify Deno version supports the required features
- Run `deno cache main.ts` to pre-download dependencies

**API rate limiting:**
- The server automatically handles rate limiting
- If you see 429 errors, the built-in delays may need adjustment

**Cache issues:**
- Clear cache directory if you encounter stale data
- Check disk space if cache operations fail

### Debug Mode

Run with additional logging:
```bash
DENO_LOG=debug deno run --allow-net --allow-read --allow-write --allow-env --unstable-temporal main.ts
```

### Network Issues

Test API connectivity:
```bash
curl -H "User-Agent: MCP-Scryfall-Client/1.0" "https://api.scryfall.com/cards/named?fuzzy=lightning%20bolt"
```

## Performance Notes

- **First Run**: Slower due to cache building
- **Subsequent Runs**: Faster with cached data
- **Rate Limiting**: 75ms between API calls (respectful to Scryfall)
- **Cache Expiry**: Similar cards cached for 1 year, regular cards indefinitely

## API Limits and Fair Use

This server respects the following limits:
- **Scryfall API**: No official rate limit, but we use 75ms delays
- **EDHREC API**: Unofficial API, cached aggressively (1 year TTL)
- **User-Agent**: Properly identifies requests as "MCP-Scryfall-Client/1.0"

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

[Insert License Information]

## Acknowledgments

- **[Scryfall](https://scryfall.com/)** - Comprehensive Magic: The Gathering card database and API
- **[EDHREC](https://edhrec.com/)** - Commander deck statistics and similar card recommendations
- **[Model Context Protocol](https://modelcontextprotocol.io/)** - Protocol specification and SDK
- **[Deno](https://deno.land/)** - Modern JavaScript/TypeScript runtime

## Support

For issues, questions, or contributions:
- Open an issue on GitHub
- Check existing issues for solutions
- Review the troubleshooting section above

---

*This MCP server is not affiliated with Wizards of the Coast, Scryfall, or EDHREC.*
