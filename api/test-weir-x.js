
export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({
            success: false,
            error: "Method not allowed"
        });
    }

    const apiKey = process.env.WEIR_API_KEY;

    if (!apiKey) {
        return res.status(500).json({
            success: false,
            error: "WEIR_API_KEY belum tersedia"
        });
    }

    const username = String(req.query.username || "blknoiz06")
        .replace(/^@/, "")
        .trim();

    try {
        const headers = {
            "Authorization": `Bearer ${apiKey}`,
            "Accept": "application/json"
        };

        // Test profile
        const profileResponse = await fetch(
            `https://api.weirapp.io/v1/x/users/${encodeURIComponent(username)}`,
            { headers }
        );

        const profileText = await profileResponse.text();

        let profile;
        try {
            profile = JSON.parse(profileText);
        } catch {
            profile = { raw: profileText };
        }

        if (!profileResponse.ok) {
            return res.status(200).json({
                success: false,
                provider: "Weir",
                stage: "Profile",
                status: profileResponse.status,
                result: profile
            });
        }

        // Test timeline
        const postsResponse = await fetch(
            `https://api.weirapp.io/v1/x/users/${encodeURIComponent(username)}/posts?limit=20`,
            { headers }
        );

        const postsText = await postsResponse.text();

        let posts;
        try {
            posts = JSON.parse(postsText);
        } catch {
            posts = { raw: postsText };
        }

        return res.status(200).json({
            success: postsResponse.ok,
            provider: "Weir",
            username,
            profile: {
                success: profileResponse.ok,
                creditsCharged: profileResponse.headers.get("x-credits-charged"),
                result: profile
            },
            timeline: {
                success: postsResponse.ok,
                status: postsResponse.status,
                creditsCharged: postsResponse.headers.get("x-credits-charged"),
                result: posts
            }
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            provider: "Weir",
            error: error.message
        });
    }
}
