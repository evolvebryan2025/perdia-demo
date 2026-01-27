/**
 * Test WordPress REST API Connection
 *
 * Run with: node --experimental-strip-types scripts/test-wordpress-api.js
 * Or: npx vite-node scripts/test-wordpress-api.js
 *
 * Tests:
 * 1. Authentication with Application Password
 * 2. User permissions check
 * 3. Create draft post
 * 4. Delete test post
 */

// Load environment variables
import 'dotenv/config'

const WP_STAGING_URL = 'https://stage.geteducated.com/wp-json/wp/v2'
const WP_USERNAME = process.env.VITE_WP_USERNAME || 'wwelsh'
const WP_APP_PASSWORD = process.env.VITE_WP_APP_PASSWORD

if (!WP_APP_PASSWORD) {
  console.error('ERROR: VITE_WP_APP_PASSWORD not set in environment')
  console.log('Add to .env.local: VITE_WP_APP_PASSWORD=Nr0r oV2Z c3LP DEOa Hqwm 0N9b')
  process.exit(1)
}

function getAuthHeader() {
  const credentials = `${WP_USERNAME}:${WP_APP_PASSWORD}`
  return `Basic ${Buffer.from(credentials).toString('base64')}`
}

async function testConnection() {
  console.log('\n=== WordPress REST API Connection Test ===\n')
  console.log(`Endpoint: ${WP_STAGING_URL}`)
  console.log(`Username: ${WP_USERNAME}`)
  console.log(`Password: ${WP_APP_PASSWORD.substring(0, 8)}...`)

  try {
    // Test 1: Get current user
    console.log('\n1. Testing authentication...')
    const userResponse = await fetch(`${WP_STAGING_URL}/users/me`, {
      headers: { 'Authorization': getAuthHeader() }
    })

    if (!userResponse.ok) {
      const error = await userResponse.text()
      console.error(`   FAILED: ${userResponse.status} - ${error}`)
      return false
    }

    const user = await userResponse.json()
    console.log(`   SUCCESS: Logged in as ${user.name} (ID: ${user.id})`)
    console.log(`   Roles: ${user.roles?.join(', ') || 'N/A'}`)

    // Test 2: Check post capabilities
    console.log('\n2. Testing post creation...')
    const testPost = {
      title: '[TEST] Perdia API Connection Test - DELETE ME',
      content: '<p>This is a test post from Perdia v5. It should be deleted immediately.</p>',
      status: 'draft',
      meta: {
        _perdia_test: 'true',
        _perdia_test_time: new Date().toISOString(),
      }
    }

    const createResponse = await fetch(`${WP_STAGING_URL}/posts`, {
      method: 'POST',
      headers: {
        'Authorization': getAuthHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testPost)
    })

    if (!createResponse.ok) {
      const error = await createResponse.text()
      console.error(`   FAILED: ${createResponse.status} - ${error}`)
      return false
    }

    const createdPost = await createResponse.json()
    console.log(`   SUCCESS: Created draft post ID ${createdPost.id}`)
    console.log(`   URL: ${createdPost.link}`)

    // Test 3: Delete the test post
    console.log('\n3. Cleaning up test post...')
    const deleteResponse = await fetch(`${WP_STAGING_URL}/posts/${createdPost.id}?force=true`, {
      method: 'DELETE',
      headers: { 'Authorization': getAuthHeader() }
    })

    if (!deleteResponse.ok) {
      console.warn(`   WARNING: Could not delete test post ${createdPost.id}`)
    } else {
      console.log(`   SUCCESS: Deleted test post ${createdPost.id}`)
    }

    // Test 4: Fetch Article Contributor sitemap
    console.log('\n4. Fetching Article Contributors...')
    try {
      const sitemapResponse = await fetch('https://stage.geteducated.com/article_contributor-sitemap.xml')
      const sitemapXml = await sitemapResponse.text()

      const urlMatches = sitemapXml.matchAll(/<loc>([^<]+article-contributors[^<]+)<\/loc>/g)
      const contributors = [...urlMatches].map(m => m[1])

      console.log(`   Found ${contributors.length} contributors:`)
      contributors.slice(0, 5).forEach(url => {
        const name = url.split('article-contributors/')[1].replace(/\/$/, '')
        console.log(`   - ${name}`)
      })
      if (contributors.length > 5) {
        console.log(`   ... and ${contributors.length - 5} more`)
      }
    } catch (e) {
      console.log(`   WARNING: Could not fetch sitemap: ${e.message}`)
    }

    console.log('\n=== All Tests Passed ===\n')
    return true

  } catch (error) {
    console.error(`\nERROR: ${error.message}`)
    return false
  }
}

testConnection().then(success => {
  process.exit(success ? 0 : 1)
})
