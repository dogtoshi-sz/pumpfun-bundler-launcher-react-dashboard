/**
 * Marketing Helper Functions
 * 
 * These functions handle website updates, Telegram group creation, and Twitter posting
 * after a successful token launch. They are called from index.ts after launch SUCCESS.
 * 
 * NOTE: These functions call the API server endpoints, which in turn call the marketing modules.
 * This keeps the launch script (index.ts) clean and allows the API server to handle the logic.
 */

interface TokenData {
  tokenName: string
  tokenSymbol: string
  tokenAddress: string
  chain: string
  website?: string
  telegram?: string
  twitter?: string
  description?: string
  websiteLogoUrl?: string
  tokenLogoUrl?: string
  tokenImageBase64?: string
}

interface WebsiteConfig {
  siteUrl: string
  secret?: string
}

interface TelegramConfig {
  apiId: string
  apiHash: string
  phone: string
  createGroup: boolean
  createChannel: boolean
  channelUsername?: string
  groupTitleTemplate: string
  useSafeguardBot: boolean
  safeguardBotUsername: string
  createPortal: boolean
}

interface TwitterConfig {
  apiKey: string
  apiSecret: string
  accessToken: string
  accessTokenSecret: string
  tweets: string[]
  tweetDelays?: number[]
  tweetImages?: (string | null)[]
  updateProfile: boolean
  deleteOldTweets: boolean
}

/**
 * Update website configuration in PostgreSQL database
 */
export async function updateWebsite(
  tokenData: TokenData,
  websiteConfig: WebsiteConfig
): Promise<any> {
  const apiUrl = process.env.API_SERVER_URL || 'http://localhost:3001'
  
  // Handle theme - match Nodematrix logic
  const websiteTheme = process.env.WEBSITE_THEME || 'DEFAULT'
  let colorScheme: string | undefined = undefined // Don't set default - let database keep existing value
  let darkMode = false
  
  if (websiteTheme === 'CUSTOM' && process.env.WEBSITE_CUSTOM_COLOR) {
    colorScheme = process.env.WEBSITE_CUSTOM_COLOR
    darkMode = false
  } else if (websiteTheme && websiteTheme !== 'DEFAULT' && websiteTheme !== 'CUSTOM') {
    // Handle Theme1, Theme2, Theme3 as structured themes (not just colors)
    if (websiteTheme === 'THEME1' || websiteTheme === 'THEME2' || websiteTheme === 'THEME3') {
      colorScheme = websiteTheme.toUpperCase()
    } else {
      // Other themes (BLUE, GREEN, etc.) are color-based
      colorScheme = websiteTheme.toUpperCase()
    }
    darkMode = false
  }
  // If DEFAULT, leave colorScheme as undefined so it doesn't update the database field (uses original theme)
  
  const response = await fetch(`${apiUrl}/api/marketing/website/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vercelSiteUrl: websiteConfig.siteUrl,
      secret: websiteConfig.secret || '',
      tokenConfig: {
        tokenName: tokenData.tokenName,
        tokenSymbol: tokenData.tokenSymbol,
        tokenAddress: tokenData.tokenAddress,
        website: tokenData.website || '',
        telegram: tokenData.telegram || '',
        twitter: tokenData.twitter || '',
        description: tokenData.description || '',
        chain: tokenData.chain,
        logoUrl: process.env.WEBSITE_LOGO || tokenData.websiteLogoUrl || null,
        tokenImageUrl: tokenData.tokenLogoUrl || null,
        ...(colorScheme !== undefined && { colorScheme: colorScheme }), // Only include if defined (DEFAULT theme won't update)
        darkMode: darkMode,
      }
    })
  })
  
  if (!response.ok) {
    const errorText = await response.text()
    // Truncate base64 images in error messages to avoid log spam
    const truncatedError = errorText.length > 200 ? errorText.substring(0, 200) + '...' : errorText
    // Don't throw - return error result instead (graceful failure)
    try {
      const errorResult = JSON.parse(errorText)
      return {
        success: false,
        error: errorResult.error || `HTTP ${response.status}: ${truncatedError}`,
      }
    } catch (e) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${truncatedError}`,
      }
    }
  }
  
  const result = await response.json()
  if (!result.success) {
    // Don't throw - return error result (graceful failure)
    return {
      success: false,
      error: result.error || 'Failed to update website',
    }
  }
  
  return result
}

/**
 * Create Telegram group/channel
 */
export async function createTelegramGroup(
  tokenData: TokenData,
  telegramConfig: TelegramConfig
): Promise<{
  groupChatId?: string
  channelChatId?: string
  telegramLink?: string
}> {
  const apiUrl = process.env.API_SERVER_URL || 'http://localhost:3001'
  
  // Build filter script with placeholders replaced
  const filterScript = `/filter CA ${tokenData.tokenAddress}\n/filter website ${tokenData.website || ''}\n/filter X ${tokenData.twitter || ''}`
  
  const response = await fetch(`${apiUrl}/api/marketing/telegram/create-group`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config: {
        telegram_api_id: telegramConfig.apiId,
        telegram_api_hash: telegramConfig.apiHash,
        telegram_phone: telegramConfig.phone,
        token_name: tokenData.tokenName,
        token_symbol: tokenData.tokenSymbol,
        token_address: tokenData.tokenAddress,
        website: tokenData.website || '',
        telegram: tokenData.telegram || '',
        twitter: tokenData.twitter || '',
        description: tokenData.description || '',
        chain: tokenData.chain,
        create_group: telegramConfig.createGroup,
        create_channel: telegramConfig.createChannel,
        channel_username: telegramConfig.channelUsername || null,
        group_title_template: telegramConfig.groupTitleTemplate,
        group_description: tokenData.description || '',
        token_image_url: tokenData.tokenLogoUrl || null,
        use_safeguard_bot: telegramConfig.useSafeguardBot,
        safeguard_bot_username: telegramConfig.safeguardBotUsername,
        create_portal: telegramConfig.createPortal,
        filter_script: filterScript,
        users: {},
        invite_users: [],
      },
      scripted_conversations: [],
    })
  })
  
  if (!response.ok) {
    const errorText = await response.text()
    // Truncate base64 images in error messages to avoid log spam
    const truncatedError = errorText.length > 500 ? errorText.substring(0, 500) + '...' : errorText
    throw new Error(`HTTP ${response.status}: ${truncatedError}`)
  }
  
  const result = await response.json()
  if (!result.success) {
    throw new Error(result.error || result.message || 'Failed to create Telegram group')
  }
  
  return {
    groupChatId: result.group_chat_id,
    channelChatId: result.channel_chat_id,
    telegramLink: result.telegram_link,
  }
}

/**
 * Post tweets and update Twitter profile
 */
export async function postToTwitter(
  tokenData: TokenData,
  twitterConfig: TwitterConfig
): Promise<{
  tweetIds: string[]
  profileUpdated: boolean
}> {
  const apiUrl = process.env.API_SERVER_URL || 'http://localhost:3001'
  
  const response = await fetch(`${apiUrl}/api/marketing/twitter/auto-post`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: twitterConfig.apiKey,
      apiSecret: twitterConfig.apiSecret,
      accessToken: twitterConfig.accessToken,
      accessTokenSecret: twitterConfig.accessTokenSecret,
      tweets: twitterConfig.tweets,
      tweetDelays: twitterConfig.tweetDelays || [],
      tweetImages: twitterConfig.tweetImages || [],
      updateProfile: twitterConfig.updateProfile,
      updateUsername: false, // Twitter API doesn't support username changes
      deleteOldTweets: twitterConfig.deleteOldTweets,
      profileConfig: {
        name: `${tokenData.tokenName} ($${tokenData.tokenSymbol})`,
        username: '',
        description: tokenData.description || '',
        url: tokenData.website || '',
        profilePicture: tokenData.tokenImageBase64 || null,
        profileHeader: null,
      },
      tokenConfig: {
        tokenName: tokenData.tokenName,
        tokenSymbol: tokenData.tokenSymbol,
        tokenAddress: tokenData.tokenAddress,
        website: tokenData.website || '',
        telegram: tokenData.telegram || '',
        twitter: tokenData.twitter || '',
        description: tokenData.description || '',
        chain: tokenData.chain,
        tokenImageBase64: tokenData.tokenImageBase64,
      },
    })
  })
  
  if (!response.ok) {
    const errorText = await response.text()
    // Truncate base64 images in error messages to avoid log spam
    const truncatedError = errorText.length > 500 ? errorText.substring(0, 500) + '...' : errorText
    throw new Error(`HTTP ${response.status}: ${truncatedError}`)
  }
  
  const result = await response.json()
  if (!result.success) {
    throw new Error(result.error || result.message || 'Failed to post to Twitter')
  }
  
  return {
    tweetIds: result.tweets?.tweetIds || [],
    profileUpdated: result.profileUpdated || false,
  }
}

