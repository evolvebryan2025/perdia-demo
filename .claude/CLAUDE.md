# perdiav5 - Claude Code Context

> **Initialized:** 2025-12-15 | **Updated:** 2026-03-03

## Project Description

Perdia v5 is an AI-powered content production system built with React 19, Vite, and Supabase. The application orchestrates a two-pass AI generation pipeline (Grok for drafting → StealthGPT for humanization) to produce SEO-optimized articles with automated quality assurance, contributor assignment, and WordPress publishing capabilities.

**Primary Client:** GetEducated.com

## Global Tools Available

This project is connected to the Disruptors global development environment.

### Automatic Time Tracking
All work is automatically logged to `~/.claude/timesheet/logs/`
- Sessions, prompts, and tool usage captured
- Time calculated in 15-minute blocks (0.25 hrs each)

### Commands
| Command | Description |
|---------|-------------|
| `/hours` | Quick timesheet summary |
| `/hours week` | Last 7 days summary |
| `/timesheet` | Detailed breakdown |
| `/notion-sync` | Push to Notion |
| `/init` | Re-run this setup |
| `/get-env` | Show project's service configs |

### MCP Servers
- **Notion** - Page/database management
- **GoHighLevel** - CRM integration
- **Supabase** - Database (project ref: nvffvcjtrgxnunncdafz)
- **Netlify** - Deployments (site: perdiav55)

### Subagents
- `timesheet-reporter` - "Generate my timesheet"
- `notion-timesheet` - "Sync to Notion"
- `project-init` - "Initialize this project"

## Service Configuration

| Service | Project/Site | ID |
|---------|--------------|-----|
| Supabase | perdiav5 | nvffvcjtrgxnunncdafz |
| Netlify | perdiav55 | 528fd438-9334-4787-a6c1-174d7388e9b2 |
| GitHub | disruptorsai/perdiav5-1 | - |

**Live URL:** https://perdiav55.netlify.app
**DB Host:** db.nvffvcjtrgxnunncdafz.supabase.co
**Supabase MCP:** https://mcp.supabase.com/mcp?project_ref=nvffvcjtrgxnunncdafz

## Project Notes

- See root `CLAUDE.md` for detailed project architecture and conventions
- AI generation pipeline: Grok → StealthGPT → Claude (fallback)
- 4 approved authors: Tony Huffman, Kayleigh Gilbert, Sara, Charity
- See `docs/v5-updates/` for GetEducated-specific requirements

## Key Files

- `src/services/generationService.js` - Main AI generation pipeline
- `src/services/ai/grokClient.js` - Grok API client (drafting)
- `src/services/ai/stealthGptClient.js` - StealthGPT client (humanization)
- `src/services/ai/claudeClient.js` - Claude API client (fallback/revision)
- `src/contexts/AuthContext.jsx` - Authentication layer
- `src/App.jsx` - Main routing
- `supabase/migrations/` - Database migrations (72 files)

## Supabase CLI

```bash
# Link to project (already configured)
supabase link --project-ref nvffvcjtrgxnunncdafz

# Push new migrations
supabase db push

# Check migration status
supabase migration list

# Repair a failed migration
supabase migration repair --status reverted <version>
```

Requires `SUPABASE_ACCESS_TOKEN` env var or `supabase login`.

---
*Global system docs: ~/Documents/personal/claude-timesheet-system/*
