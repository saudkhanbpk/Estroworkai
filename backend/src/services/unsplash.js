const logger = require('../utils/logger');

/**
 * Search photos on Unsplash
 * @param {string} query - Search query
 * @param {number} perPage - Number of results per page
 * @returns {Promise<Array>} - Array of photo objects
 */
async function searchPhotos(query, perPage = 10) {
    const accessKey = process.env.UNSPLASH_ACCESS_KEY;

    if (!accessKey) {
        logger.error('UNSPLASH_ACCESS_KEY is not defined in environment variables');
        throw new Error('Unsplash API key is missing');
    }

    try {
        const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${perPage}`;

        const response = await fetch(url, {
            headers: {
                'Authorization': `Client-ID ${accessKey}`,
                'Accept-Version': 'v1'
            }
        });

        if (!response.ok) {
            const errorData = await response.json();
            logger.error('Unsplash API error:', errorData);
            throw new Error(`Unsplash API error: ${response.statusText}`);
        }

        const data = await response.json();

        // Transform to a simpler format for the AI agent
        return data.results.map(photo => ({
            id: photo.id,
            description: photo.description || photo.alt_description || 'Unsplash Image',
            url: photo.urls.regular,
            thumb: photo.urls.thumb,
            user: {
                name: photo.user.name,
                link: photo.user.links.html
            }
        }));
    } catch (error) {
        logger.error('Error searching Unsplash photos:', error.message);
        throw error;
    }
}

module.exports = {
    searchPhotos
};
