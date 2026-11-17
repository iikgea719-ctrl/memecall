
export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({
            success: false,
            error: "Method not allowed"
        });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY;

    if (!supabaseUrl || !supabaseKey) {
        return res.status(500).json({
            success: false,
            error: "Supabase environment variables are missing"
        });
    }

    try {
        const baseUrl = supabaseUrl.replace(/\/$/, "");

        const response = await fetch(
            `${baseUrl}/rest/v1/influencer_posts?select=id,post_id,username,post_text,media,post_url,posted_at,saved_at&order=posted_at.desc&limit=100`,
            {
                method: "GET",
                headers: {
                    apikey: supabaseKey,
                    Authorization: `Bearer ${supabaseKey}`
                }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            console.error("Supabase error:", data);

            return res.status(500).json({
                success: false,
                error: "Failed to load influencer posts"
            });
        }

        return res.status(200).json({
            success: true,
            source: "Supabase",
            total: data.length,
            posts: data
        });

    } catch (error) {
        console.error("Influencer feed error:", error);

        return res.status(500).json({
            success: false,
            error: "Internal server error"
        });
    }
}
