/**
 * Twitter/X Posting Module
 * 
 * Posts tweets and updates Twitter profile using Twitter API v2
 * Based on Nodematrix-v2 implementation
 */

// Import twitter-api-v2 with proper handling for ts-node
let TwitterApiModule: any;
try {
  TwitterApiModule = require('twitter-api-v2');
} catch (error) {
  // Fallback: try to load from api-server node_modules
  try {
    TwitterApiModule = require('../../api-server/node_modules/twitter-api-v2');
  } catch (e) {
    throw new Error('twitter-api-v2 module not found. Please run: cd api-server && npm install twitter-api-v2');
  }
}
const { TwitterApi } = TwitterApiModule;

interface TokenConfig {
  tokenName?: string;
  tokenSymbol?: string;
  tokenAddress?: string;
  pumpVanityPublicKey?: string;
  website?: string;
  telegram?: string;
  twitter?: string;
  description?: string;
  chain?: string;
  tokenImageBase64?: string;
}

interface ProfileConfig {
  name?: string;
  username?: string;
  description?: string;
  url?: string;
  profilePicture?: string | null;
  profileHeader?: string | null;
}

interface TwitterPostOptions {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
  tweets?: string[];
  tweetDelays?: number[];
  tweetImages?: (string | null)[];
  updateProfile?: boolean;
  updateUsername?: boolean;
  deleteOldTweets?: boolean;
  profileConfig?: ProfileConfig;
  tokenConfig?: TokenConfig;
  communityId?: string; // Post to a specific community
}

/**
 * Replace placeholders in tweet text
 */
function replacePlaceholders(text: string, config: TokenConfig): string {
  if (!config) return text;
  
  let result = text;
  
  // Token name variations
  result = result.replace(/\[Token\]/gi, config.tokenName || 'Token');
  result = result.replace(/\[TOKEN\]/gi, config.tokenName || 'Token');
  result = result.replace(/\[token\]/gi, config.tokenName || 'Token');
  result = result.replace(/\[token_name\]/gi, config.tokenName || 'Token');
  
  // Symbol variations
  result = result.replace(/\[Symbol\]/gi, config.tokenSymbol || '$TOKEN');
  result = result.replace(/\[SYMBOL\]/gi, config.tokenSymbol || '$TOKEN');
  result = result.replace(/\[symbol\]/gi, config.tokenSymbol || '$TOKEN');
  result = result.replace(/\[token_symbol\]/gi, config.tokenSymbol || '$TOKEN');
  
  // Contract address - prioritize vanity address for Solana, otherwise use tokenAddress
  let contractAddress = '';
  if (config.chain?.toLowerCase() === 'solana' && config.pumpVanityPublicKey) {
    contractAddress = config.pumpVanityPublicKey;
  } else if (config.tokenAddress) {
    contractAddress = config.tokenAddress;
  }
  
  // Only replace [CA] if we have a contract address
  if (contractAddress) {
    result = result.replace(/\[contract address\]/gi, contractAddress);
    result = result.replace(/\[Contract Address\]/gi, contractAddress);
    result = result.replace(/\[CONTRACT ADDRESS\]/gi, contractAddress);
    result = result.replace(/\[CA\]/gi, contractAddress);
    result = result.replace(/\[ca\]/gi, contractAddress);
  }
  
  // Other placeholders
  result = result.replace(/\[Website\]/gi, config.website || '');
  result = result.replace(/\[website\]/gi, config.website || '');
  result = result.replace(/\[Telegram\]/gi, config.telegram || '');
  result = result.replace(/\[telegram\]/gi, config.telegram || '');
  result = result.replace(/\[Twitter\]/gi, config.twitter || '');
  result = result.replace(/\[twitter\]/gi, config.twitter || '');
  result = result.replace(/\[Chain\]/gi, config.chain || 'Ethereum');
  result = result.replace(/\[chain\]/gi, config.chain || 'Ethereum');
  result = result.replace(/\[description\]/gi, config.description || '');
  
  return result;
}

/**
 * Sleep/delay function
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get Twitter account information
 */
export async function getTwitterAccountInfo(credentials: {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}): Promise<{
  success: boolean;
  account?: {
    id: string;
    username: string;
    name: string;
    description?: string;
    profileImageUrl?: string;
    verified?: boolean;
    followersCount?: number;
    followingCount?: number;
    tweetCount?: number;
  };
  error?: string;
}> {
  try {
    const { apiKey, apiSecret, accessToken, accessTokenSecret } = credentials;

    if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
      throw new Error('Missing Twitter API credentials');
    }

    // Initialize Twitter client
    const client = new TwitterApi({
      appKey: apiKey,
      appSecret: apiSecret,
      accessToken: accessToken,
      accessSecret: accessTokenSecret,
    });

    const rwClient = client.readWrite;

    // Get account info using v2 API
    const user = await rwClient.v2.me({
      'user.fields': ['description', 'profile_image_url', 'verified', 'public_metrics']
    });

    return {
      success: true,
      account: {
        id: user.data.id,
        username: user.data.username,
        name: user.data.name,
        description: user.data.description,
        profileImageUrl: user.data.profile_image_url,
        verified: user.data.verified || false,
        followersCount: user.data.public_metrics?.followers_count,
        followingCount: user.data.public_metrics?.following_count,
        tweetCount: user.data.public_metrics?.tweet_count,
      },
    };
  } catch (error: any) {
    console.error('[Twitter] Get account info error:', error);
    return {
      success: false,
      error: error.message || 'Failed to get Twitter account info',
    };
  }
}

/**
 * Post tweets and update Twitter profile
 */
export async function postToTwitter(options: TwitterPostOptions): Promise<{
  success: boolean;
  tweets?: {
    tweetIds: string[];
    errors: string[];
  };
  profileUpdated?: boolean;
  profileError?: string | null;
  error?: string;
  message?: string;
}> {
  try {
    const {
      apiKey,
      apiSecret,
      accessToken,
      accessTokenSecret,
      tweets = [],
      tweetDelays = [],
      tweetImages = [],
      updateProfile = false,
      updateUsername = false,
      deleteOldTweets = false,
      profileConfig = {},
      tokenConfig = {},
    } = options;

    // Validate credentials
    if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
      throw new Error('Missing Twitter API credentials');
    }

    // Tweets are optional - allow profile-only updates
    const validTweets = tweets.filter(t => t && t.trim().length > 0);
    const hasTweets = validTweets.length > 0;
    const hasProfileUpdate = updateProfile || updateUsername;
    
    if (!hasTweets && !hasProfileUpdate) {
      throw new Error('Either tweets or profile update must be provided');
    }

    // Initialize Twitter client
    const client = new TwitterApi({
      appKey: apiKey,
      appSecret: apiSecret,
      accessToken: accessToken,
      accessSecret: accessTokenSecret,
    });

    const rwClient = client.readWrite;

    const results = {
      profileUpdated: false,
      profileError: null as string | null,
      tweets: {
        success: false,
        tweetIds: [] as string[],
        errors: [] as string[],
      },
    };

    // Update profile if requested
    if (updateProfile) {
      try {
        const updateParams: any = {};
        
        // Profile Name
        if (profileConfig.name && profileConfig.name.trim()) {
          updateParams.name = profileConfig.name.substring(0, 50);
        } else if (tokenConfig.tokenName) {
          let newName = tokenConfig.tokenName;
          if (tokenConfig.tokenSymbol) {
            newName = `${tokenConfig.tokenName} ($${tokenConfig.tokenSymbol})`;
          }
          updateParams.name = newName.substring(0, 50);
        }
        
        // Description/Bio
        let description = '';
        if (profileConfig.description && profileConfig.description.trim()) {
          description = profileConfig.description.trim();
        } else if (tokenConfig.description && tokenConfig.description.trim()) {
          description = tokenConfig.description.trim();
        }
        
        // Add contract address if available
        const tokenAddress = tokenConfig.pumpVanityPublicKey || tokenConfig.tokenAddress;
        if (tokenAddress && !description.includes(tokenAddress)) {
          if (description) {
            description = `${description}\n\nCA: ${tokenAddress}`;
          } else {
            description = `CA: ${tokenAddress}`;
          }
        }

        // Truncate to Twitter's 160 character limit
        if (description) {
          updateParams.description = description.substring(0, 160);
        }
        
        // Website URL
        if (profileConfig.url && profileConfig.url.trim()) {
          updateParams.url = profileConfig.url.trim();
        } else if (tokenConfig.website && tokenConfig.website.trim()) {
          updateParams.url = tokenConfig.website.trim();
        }

        // Update profile using v1 API
        if (Object.keys(updateParams).length > 0) {
          await rwClient.v1.updateAccountProfile(updateParams);
          console.log('[Twitter] Profile updated:', Object.keys(updateParams));
        }
        
        // Update username (Twitter API doesn't support this, but we'll log a warning)
        if (updateUsername && profileConfig.username && profileConfig.username.trim()) {
          const usernameErrorMsg = 'Twitter API does not support username changes. Please change manually at https://twitter.com/settings/screen_name';
          console.warn(`[Twitter] ${usernameErrorMsg}`);
          results.profileError = usernameErrorMsg;
        }
        
        // Update profile picture
        let profileImageBase64 = profileConfig.profilePicture || tokenConfig.tokenImageBase64;
        if (profileImageBase64) {
          try {
            let base64Data = profileImageBase64;
            if (base64Data.includes(',')) {
              base64Data = base64Data.split(',')[1];
            }
            const imageBuffer = Buffer.from(base64Data, 'base64');
            await rwClient.v1.updateAccountProfileImage(imageBuffer);
            console.log('[Twitter] Profile picture updated');
          } catch (imageError: any) {
            console.warn('[Twitter] Failed to update profile picture:', imageError.message);
          }
        }
        
        // Update header/banner image
        if (profileConfig.profileHeader) {
          try {
            let base64Data = profileConfig.profileHeader;
            if (base64Data.includes(',')) {
              base64Data = base64Data.split(',')[1];
            }
            const imageBuffer = Buffer.from(base64Data, 'base64');
            await rwClient.v1.updateAccountProfileBanner(imageBuffer);
            console.log('[Twitter] Profile header/banner updated');
          } catch (headerError: any) {
            console.warn('[Twitter] Failed to update profile header:', headerError.message);
          }
        }
        
        results.profileUpdated = true;
      } catch (error: any) {
        console.error('[Twitter] Profile update error:', error);
        results.profileError = error.message || 'Failed to update profile';
      }
    }

    // Delete old tweets if requested
    if (deleteOldTweets) {
      try {
        const user = await rwClient.v2.me();
        const timeline = await rwClient.v2.userTimeline(user.data.id, { max_results: 20 });
        
        const tweetsToDelete = timeline.data.data || [];
        for (const tweet of tweetsToDelete.slice(0, 10)) {
          try {
            await rwClient.v2.deleteTweet(tweet.id);
            console.log(`[Twitter] Deleted tweet: ${tweet.id}`);
            await sleep(1000); // Rate limit: 1 second between deletes
          } catch (deleteError: any) {
            console.warn(`[Twitter] Failed to delete tweet ${tweet.id}:`, deleteError.message);
          }
        }
        console.log(`[Twitter] Deleted ${tweetsToDelete.slice(0, 10).length} old tweet(s)`);
      } catch (error: any) {
        console.warn('[Twitter] Failed to delete old tweets:', error.message);
      }
    }

    // Post tweets
    if (hasTweets) {
      for (let i = 0; i < validTweets.length; i++) {
        try {
          const tweetText = replacePlaceholders(validTweets[i], tokenConfig);
          
          // Check tweet length (280 character limit)
          if (tweetText.length > 280) {
            const error = `Tweet ${i + 1} exceeds 280 characters (${tweetText.length} chars)`;
            console.error(`[Twitter] ${error}`);
            results.tweets.errors.push(error);
            continue;
          }

          // Handle image for this tweet
          let mediaId: string | undefined;
          if (tweetImages && tweetImages[i] && tweetImages[i] !== null) {
            try {
              // Convert base64 to buffer
              let base64Data = tweetImages[i]!;
              if (base64Data.includes(',')) {
                base64Data = base64Data.split(',')[1];
              }
              const imageBuffer = Buffer.from(base64Data, 'base64');
              
              // Upload media to Twitter
              const mediaIdResult = await rwClient.v1.uploadMedia(imageBuffer, {
                mimeType: 'image/jpeg', // Twitter will auto-detect, but we specify for clarity
              });
              mediaId = mediaIdResult;
              console.log(`[Twitter] Uploaded image for tweet ${i + 1}, media ID: ${mediaId}`);
            } catch (imageError: any) {
              console.warn(`[Twitter] Failed to upload image for tweet ${i + 1}:`, imageError.message);
              // Continue posting tweet without image
            }
          }

          // Post tweet with or without image
          const tweetOptions: any = {
            text: tweetText,
          };
          
          if (mediaId) {
            tweetOptions.media = { media_ids: [mediaId] };
          }
          
          // Add community_id if specified
          if (options.communityId) {
            tweetOptions.community_id = options.communityId;
            console.log(`[Twitter] Posting to community: ${options.communityId}`);
          }
          
          const tweet = await rwClient.v2.tweet(tweetOptions);

          results.tweets.tweetIds.push(tweet.data.id);
          console.log(`[Twitter] Posted tweet ${i + 1}/${validTweets.length}: ${tweet.data.id}${mediaId ? ' (with image)' : ''}`);
          
          // Wait before next tweet (if not last tweet)
          if (i < validTweets.length - 1) {
            const delay = tweetDelays[i] || 5; // Default 5 seconds
            console.log(`[Twitter] Waiting ${delay} seconds before next tweet...`);
            await sleep(delay * 1000);
          }
        } catch (error: any) {
          const errorMsg = `Failed to post tweet ${i + 1}: ${error.message}`;
          console.error(`[Twitter] ${errorMsg}`);
          results.tweets.errors.push(errorMsg);
        }
      }

      results.tweets.success = results.tweets.tweetIds.length > 0;
    }

    // Build success message
    let message = '';
    if (results.profileUpdated && results.tweets.tweetIds.length > 0) {
      message = `Posted ${results.tweets.tweetIds.length} tweet(s) and updated profile`;
    } else if (results.profileUpdated) {
      message = 'Profile updated successfully';
    } else if (results.tweets.tweetIds.length > 0) {
      message = `Posted ${results.tweets.tweetIds.length} tweet(s)`;
    }

    return {
      success: true,
      tweets: results.tweets,
      profileUpdated: results.profileUpdated,
      profileError: results.profileError,
      message,
    };
  } catch (error: any) {
    console.error('[Twitter] Error:', error);
    return {
      success: false,
      error: error.message || 'Failed to post to Twitter',
    };
  }
}

