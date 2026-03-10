# AI Tool Feedback Fixes (March 2026) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 7 issues from the QA team's feedback spreadsheet (Charity & Sara) covering auto-fix failures, internal link priority, external link embedding, triplicate detection, quality score mismatches, and cost data accuracy.

**Architecture:** Changes span 4 service files and 1 hook file. All fixes are prompt engineering improvements and logic adjustments — no new tables/migrations needed. The auto-fix pipeline needs site catalog context to actually fix link issues, and the generation pipeline needs triplicate detection added to quality checks.

**Tech Stack:** React 19, Supabase (existing tables), Claude API (prompt changes), Grok API (prompt changes)

---

## Issues Summary (from Excel feedback)

| # | Priority | Issue | Root Cause |
|---|----------|-------|------------|
| 1 | HIGH | Auto-fix doesn't actually fix link issues | `autoFixQualityIssues` in generationService has no site catalog context — tells Claude to "add links" but gives no URLs to link to |
| 2 | HIGH | External links not embedded | Same root cause — auto-fix prompt says "add external citations" but provides no BLS URLs; Grok draft prompt doesn't strongly require embedded external links |
| 3 | HIGH | Internal links only cite articles, not BERPs/ranks | `getRelevantSiteArticles` doesn't prioritize by `content_type`; link prompt doesn't instruct priority order |
| 4 | HIGH | Triplicate overuse (AI "rule of three") | No triplicate detection exists anywhere — not in quality checks, not in humanization prompt, not in content validator |
| 5 | MED | Quality score on dashboard tiles doesn't match editor | Dashboard reads static `quality_score` from DB column; editor recalculates dynamically. Manual edits don't update DB score |
| 6 | MED | Cost data shown as per-credit instead of total program cost | Grok prompt doesn't clarify cost data format; no instruction to avoid degree-completion ranks |
| 7 | MED | AI revision can't follow natural language link prompts | `reviseWithFeedback` has no access to GetEducated catalog for resolving vague link requests |

---

## Task 1: Fix Auto-Fix to Include Site Catalog for Link Issues

**Files:**
- Modify: `src/services/generationService.js:959-1033` (autoFixQualityIssues method)
- Modify: `src/hooks/useGeneration.js:103-139` (useAutoFixQuality hook)

**Why:** The auto-fix tells Claude "add internal links" and "add external citations" but provides ZERO URLs. Claude has nothing to link to, so the fix silently fails.

**Step 1: Update useAutoFixQuality hook to fetch site articles when link issues exist**

In `src/hooks/useGeneration.js`, replace the `useAutoFixQuality` mutation function (lines 107-132):

```javascript
mutationFn: async ({ articleId, content, issues }) => {
  // Check if any link-related issues need fixing
  const hasLinkIssues = issues.some(i =>
    ['missing_internal_links', 'missing_external_links'].includes(i.type || i.description?.toLowerCase().includes('link'))
  )

  // Fetch site articles for context if link issues exist
  let siteArticles = []
  if (hasLinkIssues) {
    try {
      // Get the article title for relevance matching
      const { data: article } = await supabase
        .from('articles')
        .select('title, topics, content_type')
        .eq('id', articleId)
        .single()

      if (article) {
        siteArticles = await generationService.getRelevantSiteArticles(
          article.title, 10, { topics: article.topics || [] }
        )
      }
    } catch (e) {
      console.warn('[AutoFix] Could not fetch site articles:', e)
    }
  }

  // Use generationService to fix issues WITH site article context
  const fixedContent = await generationService.autoFixQualityIssues(
    content,
    issues,
    siteArticles
  )

  // Recalculate quality metrics
  const metrics = generationService.calculateQualityMetrics(fixedContent, [])

  // Update article in database
  const { data, error } = await supabase
    .from('articles')
    .update({
      content: fixedContent,
      quality_score: metrics.score,
      word_count: metrics.word_count,
      risk_flags: metrics.issues.map(i => i.type),
    })
    .eq('id', articleId)
    .select()
    .single()

  if (error) throw error
  return data
},
```

**Step 2: Update autoFixQualityIssues to accept and use site articles**

In `src/services/generationService.js`, replace the `autoFixQualityIssues` method (lines 959-1033). The third parameter `currentFaqs` is already there but unused — repurpose it:

Change the method signature and add site article context to the prompt:

```javascript
async autoFixQualityIssues(content, issues, siteArticles = []) {
  const issueDescriptions = issues.map(issue => {
    switch (issue.type) {
      case 'word_count_low':
        return '- Article is too short. Add 200-300 more words with valuable information.'
      case 'word_count_high':
        return '- Article is too long. Condense and remove unnecessary repetition.'
      case 'missing_internal_links':
        return '- Missing internal links to GetEducated. You MUST add internal links using the AVAILABLE ARTICLES listed below.'
      case 'missing_external_links':
        return '- Missing external citations. You MUST add 1-2 links to authoritative sources. Use Bureau of Labor Statistics (https://www.bls.gov/ooh/) for career/salary data, or NCES (https://nces.ed.gov/) for education statistics. Use REAL URLs from these domains.'
      case 'missing_faqs':
        return '- Missing FAQ section. Add 3 relevant questions and answers.'
      case 'weak_headings':
        return '- Weak heading structure. Add 2-3 more H2 subheadings to break up content.'
      case 'poor_readability':
        return '- Poor readability. Shorten some long sentences and use simpler language.'
      default:
        return `- ${issue.type}: ${issue.severity} issue`
    }
  }).join('\n')

  // Build site articles context for internal linking
  let internalLinksContext = ''
  if (siteArticles.length > 0) {
    internalLinksContext = `

AVAILABLE ARTICLES FOR INTERNAL LINKING (you MUST use 3-5 of these):
${siteArticles.map(a => `- [${a.title}](${a.url})`).join('\n')}

When adding internal links, use HTML: <a href="URL">natural anchor text</a>
Distribute links throughout the article, not clustered together.`
  }

  const prompt = `You are reviewing an article and need to fix the following quality issues:

QUALITY ISSUES TO FIX:
${issueDescriptions}
${internalLinksContext}

CURRENT ARTICLE CONTENT:
${content}

=== CRITICAL HTML FORMATTING RULES ===
... (keep existing HTML rules) ...

=== EXTERNAL LINK GUIDELINES ===
For external citations, use ONLY these approved source domains:
- Bureau of Labor Statistics: https://www.bls.gov/ooh/ (for career outlook, salaries)
- NCES: https://nces.ed.gov/ (for education statistics)
- Department of Education: https://www.ed.gov/
- Official accreditation bodies

NEVER link to: .edu domains, onlineu.com, usnews.com, bestcolleges.com, niche.com, or any competitor sites.

When adding external links, embed them naturally in the text:
Example: <a href="https://www.bls.gov/ooh/healthcare/registered-nurses.htm">according to the Bureau of Labor Statistics</a>

INSTRUCTIONS:
1. Fix ALL the issues listed above
2. For internal links: Use the AVAILABLE ARTICLES listed above - pick the most relevant ones
3. For external links: Use REAL URLs from BLS, NCES, or .gov sites embedded as hyperlinks in the text
4. Maintain the article's overall tone and message
5. Keep the existing heading structure unless adding new headings
6. Do NOT remove existing content unless consolidating
7. Ensure all HTML tags are properly closed

OUTPUT ONLY THE COMPLETE FIXED HTML CONTENT (no explanations or commentary).`

  try {
    const fixedContent = await this.claude.chat([
      { role: 'user', content: prompt }
    ], {
      temperature: 0.7,
      max_tokens: 8000,
    })
    return fixedContent
  } catch (error) {
    console.error('Error in auto-fix:', error)
    throw error
  }
}
```

**Step 3: Verify the fix builds**

Run: `npm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add src/services/generationService.js src/hooks/useGeneration.js
git commit -m "fix: Auto-fix now fetches site catalog for internal/external link issues"
```

---

## Task 2: Prioritize BERPs and Ranks in Internal Linking

**Files:**
- Modify: `src/services/generationService.js:1389-1510` (getRelevantSiteArticles)
- Modify: `src/services/generationService.js:1542-1593` (addInternalLinksToContent prompt)

**Why:** Internal links currently only go to articles. Charity's feedback: priority should be BERPs > Ranks > Articles > Schools. The `content_type` column in `geteducated_articles` already has `ranking`, `degree_category`, `school_profile` values that map to these categories.

**Step 1: Add content type priority boost to getRelevantSiteArticles**

After the subject-aware scoring at line 1425, add a content type priority boost before taking top results:

```javascript
// Step 4.5: Boost scores based on content type priority
// Priority: BERPs (degree_category) > Rankings > Articles > Schools
const CONTENT_TYPE_BOOST = {
  'degree_category': 100,  // BERPs pages - highest priority
  'ranking': 80,           // Ranking/comparison pages
  'career': 40,            // Career guides
  'guide': 30,             // General guides
  'how_to': 30,            // How-to articles
  'listicle': 20,          // List articles
  'explainer': 20,         // Explainers
  'blog': 10,              // Blog posts
  'school_profile': 5,     // School pages - lowest
  'scholarship': 5,        // Scholarship pages
  'other': 0,
}

scoredArticles.forEach(article => {
  const boost = CONTENT_TYPE_BOOST[article.content_type] || 0
  article.relevanceScore = (article.relevanceScore || 0) + boost
  if (boost > 0) {
    article.scoringReasons = article.scoringReasons || []
    article.scoringReasons.push(`+${boost} content type boost (${article.content_type})`)
  }
})

// Re-sort after boosting
scoredArticles.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
```

**Step 2: Update addInternalLinksToContent prompt to instruct priority**

Replace the prompt in `addInternalLinksToContent` (lines 1543-1574) to include priority instructions and content type labels:

```javascript
async addInternalLinksToContent(content, siteArticles) {
  const prompt = `Add 3-5 contextual internal links to this article content.

ARTICLE CONTENT:
${content}

AVAILABLE ARTICLES TO LINK TO (listed in priority order - prefer items near the top):
${siteArticles.map(a => {
  const typeLabel = a.content_type === 'degree_category' ? '[BERP PAGE]' :
                    a.content_type === 'ranking' ? '[RANKING]' :
                    a.content_type === 'school_profile' ? '[SCHOOL]' :
                    '[ARTICLE]'
  return `- ${typeLabel} [${a.title}](${a.url})`
}).join('\n')}

=== LINKING PRIORITY RULES ===
1. PREFER linking to [BERP PAGE] (Browse Education Results Pages) - these are degree directory pages like /online-degrees/subject/level/
2. SECOND PRIORITY: [RANKING] pages - these are ranking/comparison pages
3. THIRD PRIORITY: [ARTICLE] pages - general content articles
4. LOWEST PRIORITY: [SCHOOL] pages - individual school profiles

=== CRITICAL HTML FORMATTING RULES ===

Your output MUST be properly formatted HTML with:
1. <h2> tags for major section headings
2. <h3> tags for subsections
3. <p> tags wrapping EVERY paragraph of text
4. <ul> and <li> tags for bulleted lists
5. <ol> and <li> tags for numbered lists
6. <strong> or <b> tags for bold text
7. <a href="..."> tags for any links

NEVER output plain text without HTML tags. Every paragraph MUST be wrapped in <p> tags.

=== END HTML FORMATTING RULES ===

INSTRUCTIONS:
1. Add links where genuinely relevant to the content
2. Use natural anchor text (not "click here")
3. Distribute throughout article - not all in one section
4. Use HTML format: <a href="URL">anchor text</a>
5. Aim for 3-5 links total
6. Preserve all existing HTML formatting and existing links

OUTPUT ONLY THE UPDATED HTML CONTENT with links added.`

  try {
    const linkedContent = await this.claude.chat([
      { role: 'user', content: prompt }
    ], {
      temperature: 0.7,
      max_tokens: 8000,
    })
    return linkedContent
  } catch (error) {
    console.error('Error adding internal links:', error)
    return content
  }
}
```

**Step 3: Also include content_type in the return data**

In the `return results.map(...)` block at line 1456, add `content_type`:

```javascript
return results.map(a => ({
  id: a.id,
  url: a.url,
  title: a.title,
  excerpt: a.excerpt,
  topics: a.topics,
  content_type: a.content_type,
  subject_area: a.subject_area,
  relevanceScore: a.relevanceScore,
}))
```

**Step 4: Verify build**

Run: `npm run build`

**Step 5: Commit**

```bash
git add src/services/generationService.js
git commit -m "fix: Prioritize BERPs and rankings over articles in internal linking"
```

---

## Task 3: Add Triplicate Detection to Quality & Humanization

**Files:**
- Modify: `src/services/validation/contentValidator.js` (add triplicate detection function)
- Modify: `src/services/qualityScoreService.js` (add triplicate check)
- Modify: `src/services/ai/claudeClient.js:127-259` (add anti-triplicate instruction to humanization prompt)
- Modify: `src/services/ai/grokClient.js` (add anti-triplicate instruction to draft prompt)

**Why:** Charity counted 18 triplicates in one article. AI models default to "rule of three" patterns (listing three items: "a, b, and c"). No detection exists anywhere in the codebase.

**Step 1: Add triplicate detection utility to contentValidator.js**

Add this function at the end of the file (before the default export):

```javascript
/**
 * Detect triplicate patterns (AI "rule of three") in content
 * Counts sentences/phrases that list exactly 3 items joined by commas and "and"
 * Pattern: "X, Y, and Z" or "X, Y and Z"
 *
 * @param {string} content - HTML content
 * @returns {{ count: number, examples: string[], severity: string }}
 */
export function detectTriplicates(content) {
  if (!content) return { count: 0, examples: [], severity: 'none' }

  const plainText = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

  // Pattern: "word/phrase, word/phrase, and word/phrase" or "word/phrase, word/phrase and word/phrase"
  const triplicatePattern = /\b([A-Za-z][A-Za-z\s]{1,30}),\s+([A-Za-z][A-Za-z\s]{1,30}),?\s+and\s+([A-Za-z][A-Za-z\s]{1,30})\b/gi

  const matches = []
  let match
  while ((match = triplicatePattern.exec(plainText)) !== null) {
    matches.push(match[0].trim())
  }

  // Deduplicate
  const unique = [...new Set(matches)]

  // Severity thresholds
  let severity = 'none'
  if (unique.length >= 10) severity = 'major'
  else if (unique.length >= 6) severity = 'minor'
  else if (unique.length >= 3) severity = 'info'

  return {
    count: unique.length,
    examples: unique.slice(0, 5),
    severity,
  }
}
```

**Step 2: Add triplicate check to qualityScoreService.js**

Import the function at the top of `qualityScoreService.js`:

```javascript
import { detectTriplicates } from './validation/contentValidator'
```

Add a new check in the `checks` object (after `authorAssigned`, around line 202):

```javascript
triplicates: {
  passed: detectTriplicates(content).count < 10,
  critical: false,
  enabled: true,
  label: 'Fewer than 10 triplicate patterns',
  value: `${detectTriplicates(content).count} found`,
  issue: detectTriplicates(content).count >= 10
    ? `Reduce triplicate patterns (${detectTriplicates(content).count} found). Vary sentence structure — don't always list 3 items.`
    : null
},
```

Note: Call `detectTriplicates` once and cache the result to avoid redundant calls:

```javascript
// Before the checks object, add:
const triplicateResult = detectTriplicates(content)

// Then in the check:
triplicates: {
  passed: triplicateResult.count < 10,
  critical: false,
  enabled: true,
  label: 'Fewer than 10 triplicate patterns',
  value: `${triplicateResult.count} found`,
  issue: triplicateResult.count >= 10
    ? `Reduce triplicate patterns (${triplicateResult.count} found). Vary sentence structure — don't always list 3 items.`
    : null
},
```

**Step 3: Add anti-triplicate rule to Claude humanization prompt**

In `src/services/ai/claudeClient.js`, in the `buildHumanizationPrompt` method, add to the BANNED PHRASES section (around line 233):

```
- Avoid the "rule of three" pattern — do NOT always list exactly 3 items in sentences. Humans vary between 2, 4, and 5 items naturally. If you find yourself writing "X, Y, and Z" more than 3 times in an article, rewrite some as pairs or longer lists.
```

**Step 4: Add anti-triplicate rule to Grok draft prompt**

In `src/services/ai/grokClient.js`, in the `buildDraftPrompt` method, add to the content quality rules:

```
- VARY LIST LENGTH: Do NOT always list exactly 3 items ("X, Y, and Z"). This is a known AI pattern. Mix it up — sometimes list 2 items, sometimes 4 or 5. Avoid the "rule of three" pattern.
```

**Step 5: Add triplicate issue type to autoFixQualityIssues**

In `generationService.js` `autoFixQualityIssues`, add a new case:

```javascript
case 'triplicates':
  return '- Too many triplicate patterns (listing exactly 3 items). Rewrite some "X, Y, and Z" patterns to use 2 items or 4+ items instead. Vary the sentence structure.'
```

**Step 6: Verify build**

Run: `npm run build`

**Step 7: Commit**

```bash
git add src/services/validation/contentValidator.js src/services/qualityScoreService.js src/services/ai/claudeClient.js src/services/ai/grokClient.js src/services/generationService.js
git commit -m "feat: Add triplicate detection to quality checks and anti-triplicate rules to AI prompts"
```

---

## Task 4: Fix Quality Score Mismatch Between Dashboard and Editor

**Files:**
- Modify: `src/pages/ArticleEditor.jsx` (recalculate and save quality_score on every content save)

**Why:** Dashboard reads `quality_score` from the DB column (set at generation time). Editor recalculates dynamically. When content is manually edited, the DB column isn't updated — so dashboard shows the old score.

**Step 1: Update handleSave to always recalculate quality score**

In `ArticleEditor.jsx`, update the `handleSave` function (lines 161-184) and `handleSaveWithContent` (lines 188-208):

Import `calculateQualityScore` and `getQualityThresholds` at the top:

```javascript
import { calculateQualityScore, getQualityThresholds } from '../services/qualityScoreService'
```

Update `handleSave`:

```javascript
const handleSave = async () => {
  setSaving(true)
  try {
    // Always recalculate quality score from current content before saving
    const thresholds = await getQualityThresholds()
    const freshQuality = calculateQualityScore(content, {
      contributor_id: selectedContributorId,
      faqs,
    }, thresholds)

    await updateArticle.mutateAsync({
      articleId,
      updates: {
        title,
        content,
        meta_description: metaDescription,
        focus_keyword: focusKeyword,
        content_type: contentType,
        contributor_id: selectedContributorId,
        faqs,
        word_count: freshQuality.word_count,
        quality_score: freshQuality.score
      }
    })
    toast.success('Article saved successfully')
  } catch (error) {
    toast.error('Failed to save: ' + error.message)
  } finally {
    setSaving(false)
  }
}
```

Update `handleSaveWithContent` similarly:

```javascript
const handleSaveWithContent = useCallback(async (newContent) => {
  try {
    const thresholds = await getQualityThresholds()
    const freshQuality = calculateQualityScore(newContent, {
      contributor_id: selectedContributorId,
      faqs,
    }, thresholds)

    await updateArticle.mutateAsync({
      articleId,
      updates: {
        title,
        content: newContent,
        meta_description: metaDescription,
        focus_keyword: focusKeyword,
        content_type: contentType,
        contributor_id: selectedContributorId,
        faqs,
        word_count: freshQuality.word_count,
        quality_score: freshQuality.score
      }
    })
  } catch (error) {
    throw error
  }
}, [articleId, title, metaDescription, focusKeyword, contentType, selectedContributorId, faqs, updateArticle])
```

**Step 2: Verify build**

Run: `npm run build`

**Step 3: Commit**

```bash
git add src/pages/ArticleEditor.jsx
git commit -m "fix: Recalculate quality score on every save to keep dashboard in sync"
```

---

## Task 5: Fix Cost Data Accuracy in Grok Prompts

**Files:**
- Modify: `src/services/ai/grokClient.js` (buildDraftPrompt method)

**Why:** Articles cite per-credit cost as total program cost. Charity: "Degree-completion ranks list per-credit costs. The system uses degree-completion ranks and lists the total cost based on the per-credit cost listing."

**Step 1: Add cost data clarification to Grok's draft prompt**

In `grokClient.js`, in the `buildDraftPrompt` method, add this to the cost data section:

```
=== COST DATA RULES (CRITICAL) ===
1. When citing costs from ranking reports, use TOTAL PROGRAM COST, not per-credit cost
2. If the data source shows per-credit cost, you MUST multiply by total credits to get total program cost, or simply say "starting at $X per credit hour"
3. AVOID degree-completion rankings — use standard degree program rankings instead
4. Always specify what the cost number represents: "total program cost", "per credit hour", etc.
5. When listing affordable programs, cite the CHEAPEST client school options first
6. If no client schools are available for a topic, use the cheapest non-client options
7. NEVER present per-credit costs as if they are total program costs
===
```

**Step 2: Verify build**

Run: `npm run build`

**Step 3: Commit**

```bash
git add src/services/ai/grokClient.js
git commit -m "fix: Add cost data formatting rules to prevent per-credit vs total cost confusion"
```

---

## Task 6: Improve AI Revision Context for Natural Language Link Requests

**Files:**
- Modify: `src/services/ai/claudeClient.js:350-455` (reviseWithFeedback)

**Why:** When users say "Link to GetEducated's forensic science master's page" or "Replace with a client degree", the AI invents URLs or creates fake schools because it has no access to the site catalog.

This is partially fixed in `useReviseWithFeedback` (the hook in useGeneration.js, line 254) which already fetches site articles for link-related feedback. But `reviseWithFeedback` in claudeClient.js (used by `useReviseArticle` at line 156) does NOT have this context.

**Step 1: Update reviseWithFeedback to accept optional site catalog context**

In `claudeClient.js`, update the `reviseWithFeedback` method signature and prompt:

```javascript
async reviseWithFeedback(content, feedbackItems, options = {}) {
  const { siteArticles = [], costData = [] } = options
```

Add site catalog context to the prompt (before the `=== OUTPUT REQUIREMENTS ===` section):

```javascript
// After the EDITORIAL FEEDBACK section, before OUTPUT REQUIREMENTS
let catalogContext = ''
if (siteArticles.length > 0) {
  catalogContext = `
=== AVAILABLE GETEDUCATED PAGES (use these for any link requests) ===

${siteArticles.map(a => {
  const typeLabel = a.content_type === 'degree_category' ? '[BERP]' :
                    a.content_type === 'ranking' ? '[RANKING]' :
                    '[ARTICLE]'
  return `- ${typeLabel} ${a.title}: ${a.url}`
}).join('\n')}

IMPORTANT: When feedback asks to "link to GetEducated's X page" or "add a link to Y", search this list for the best match. NEVER invent URLs — only use URLs from this list or from approved external domains (bls.gov, nces.ed.gov, .gov sites).

If no matching page exists in this list, inform the user by leaving a comment like <!-- NO MATCHING PAGE FOUND FOR: [requested topic] --> rather than inventing a URL.
=== END AVAILABLE PAGES ===
`
}
```

**Step 2: Update useReviseArticle hook to pass site articles**

In `src/hooks/useGeneration.js`, update the `useReviseArticle` mutation (lines 146-225) to fetch site articles:

```javascript
mutationFn: async ({ articleId, content, feedbackItems }) => {
  const contentWithoutImages = stripImagesFromHtml(content)

  // Check if any feedback is link-related
  const feedbackText = feedbackItems.map(f => f.comment).join(' ').toLowerCase()
  const isLinkRelated = feedbackText.includes('link') ||
                        feedbackText.includes('url') ||
                        feedbackText.includes('source') ||
                        feedbackText.includes('cite') ||
                        feedbackText.includes('client') ||
                        feedbackText.includes('degree') ||
                        feedbackText.includes('school') ||
                        feedbackText.includes('replace')

  // Fetch site articles if link-related feedback
  let siteArticles = []
  if (isLinkRelated) {
    try {
      const { data: article } = await supabase
        .from('articles')
        .select('title, topics')
        .eq('id', articleId)
        .single()

      if (article) {
        siteArticles = await generationService.getRelevantSiteArticles(
          article.title, 15, { topics: article.topics || [] }
        )
      }
    } catch (e) {
      console.warn('[useReviseArticle] Could not fetch site articles:', e)
    }
  }

  // Use Claude to revise based on feedback WITH catalog context
  const revisedContent = await generationService.claude.reviseWithFeedback(
    contentWithoutImages,
    feedbackItems,
    { siteArticles }
  )
  // ... rest stays the same
```

**Step 3: Verify build**

Run: `npm run build`

**Step 4: Commit**

```bash
git add src/services/ai/claudeClient.js src/hooks/useGeneration.js
git commit -m "fix: Provide site catalog context to AI revisions for natural language link requests"
```

---

## Task 7: Improve Grok Draft Prompt for External Link Embedding

**Files:**
- Modify: `src/services/ai/grokClient.js` (buildDraftPrompt method)

**Why:** Sara and Charity both report that generated articles mention BLS data but don't embed actual hyperlinks. The Grok prompt tells the AI about approved external sources but doesn't strongly require embedding them as HTML links.

**Step 1: Strengthen external link requirements in Grok draft prompt**

In `grokClient.js`, in the `buildDraftPrompt` method, update the external sources section:

```
=== EXTERNAL LINKS (MANDATORY) ===
You MUST embed at least 2 external hyperlinks in the article as HTML <a> tags.

Approved external sources ONLY:
- Bureau of Labor Statistics: Use actual BLS Occupational Outlook pages, e.g., <a href="https://www.bls.gov/ooh/healthcare/registered-nurses.htm">Bureau of Labor Statistics</a>
- NCES: <a href="https://nces.ed.gov/">National Center for Education Statistics</a>
- Department of Education (.gov sites)
- Official accreditation bodies

When citing salary data, job outlook, or career statistics, you MUST embed the source as a clickable link:
CORRECT: <p>According to the <a href="https://www.bls.gov/ooh/healthcare/registered-nurses.htm">Bureau of Labor Statistics</a>, registered nurses earn a median salary of $81,220.</p>
WRONG: <p>According to the Bureau of Labor Statistics, registered nurses earn a median salary of $81,220.</p>

NEVER mention BLS or any source without embedding a hyperlink to it.
===
```

**Step 2: Verify build**

Run: `npm run build`

**Step 3: Commit**

```bash
git add src/services/ai/grokClient.js
git commit -m "fix: Require Grok to embed external sources as hyperlinks, not plain text mentions"
```

---

## Execution Order

Tasks are independent and can be executed in parallel except:
- Task 1 and Task 2 both modify `generationService.js` — do them sequentially
- Task 3 modifies `generationService.js`, `qualityScoreService.js`, `claudeClient.js`, `grokClient.js` — do after Tasks 1-2
- Task 6 modifies `claudeClient.js` and `useGeneration.js` — do after Task 1

Recommended order: **1 → 2 → 3 → 4 → 5 → 6 → 7**

After all tasks, run a final `npm run build` to verify no errors.
