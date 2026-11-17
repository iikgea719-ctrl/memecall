
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  const apiKey = process.env.XFETCH_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      success: false,
      error: "XFETCH_API_KEY belum ditemukan di Vercel"
    });
  }

  const username = String(req.query.username || "blknoiz06")
    .replace(/^@/, "")
    .trim();

  if (!username) {
    return res.status(400).json({
      success: false,
      error: "Username wajib diisi"
    });
  }

  try {
    const response = await fetch(
      `https://api.xfetch.io/v1/profiles/by-username/${encodeURIComponent(username)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json"
        }
      }
    );

    const result = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        provider: "XFetch",
        status: response.status,
        error: result
      });
    }

    const user = result?.data?.user || {};
    const tweets = result?.data?.recent_tweets || [];

    return res.status(200).json({
      success: true,
      provider: "XFetch",
      username: user.username || username,
      profile: {
        id: user.id || null,
        name: user.name || null,
        followers: user.follower_count ?? null,
        profileImage: user.profile_image_url || null
      },
      tweetsFetched: tweets.length,
      sampleTweets: tweets.slice(0, 3).map(tweet => ({
        id: tweet.id,
        text: tweet.text,
        created_at: tweet.created_at
      })),
      credits: result.meta?.credits || null,
      requestId: result.meta?.request_id || null
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      provider: "XFetch",
      error: error.message
    });
  }
}
