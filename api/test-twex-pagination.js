
export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({
            success: false,
            error: "Method not allowed"
        });
    }

    const apiKey = process.env.TWEXAPI_API_KEY;

    if (!apiKey) {
        return res.status(500).json({
            success: false,
            error: "TWEXAPI_API_KEY belum tersedia"
        });
    }

    const username = String(
        req.query.username || "blknoiz06"
    ).replace(/^@/, "").trim();

    if (!username) {
        return res.status(400).json({
            success: false,
            error: "Username kosong"
        });
    }

    const endpoint =
        `https://api.twexapi.io/twitter/${encodeURIComponent(username)}/timeline/page`;

    const headers = {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
    };

    try {
        // HALAMAN PERTAMA
        const firstResponse = await fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify({
                count: 20,
                next_cursor: ""
            })
        });

        const firstResult = await firstResponse.json();

        if (!firstResponse.ok || firstResult.code !== 200) {
            return res.status(502).json({
                success: false,
                step: "first_page",
                result: firstResult
            });
        }

        const firstData = Array.isArray(firstResult.data)
            ? firstResult.data
            : [];

        const cursor = firstResult.next_cursor;

        if (!cursor) {
            return res.status(200).json({
                success: true,
                message: "Cursor tidak ditemukan",
                firstPageTweets: firstData.length,
                secondPageTested: false
            });
        }

        // HALAMAN KEDUA
        const secondResponse = await fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify({
                count: 20,
                next_cursor: cursor
            })
        });

        const secondResult = await secondResponse.json();

        if (!secondResponse.ok || secondResult.code !== 200) {
            return res.status(502).json({
                success: false,
                step: "second_page",
                firstPageTweets: firstData.length,
                result: secondResult
            });
        }

        const secondData = Array.isArray(secondResult.data)
            ? secondResult.data
            : [];

        const firstIds = new Set(
            firstData.map(tweet => tweet.tweet_id)
        );

        const duplicateCount = secondData.filter(
            tweet => firstIds.has(tweet.tweet_id)
        ).length;

        return res.status(200).json({
            success: true,
            provider: "TwexAPI",
            testedUsername: username,
            firstPageTweets: firstData.length,
            secondPageTweets: secondData.length,
            duplicateTweets: duplicateCount,
            secondPageFirstTweet: secondData[0]?.full_text || null,
            secondPageFirstTweetId: secondData[0]?.tweet_id || null,
            secondPageNextCursor: secondResult.next_cursor || null
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            provider: "TwexAPI",
            error: error.message
        });
    }
}
