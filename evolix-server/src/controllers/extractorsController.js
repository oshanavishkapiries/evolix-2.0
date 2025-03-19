const {
    serverErrorResponse,
} = require("../utils/responceUtil");

const mixdropVideo = async (req, res) => {
    try {
        const script = require("../modules/extractors/mixdrop/videoExtractor");
        res.setHeader('Content-Type', 'application/javascript');
        res.send(script);
    } catch (error) {
        console.error('Error serving video extractor script:', error);
        return serverErrorResponse(res, 'Failed to load video extractor script');
    }
}

const mixdropSubtitle = async (req, res) => {
    try {
        const script = require("../modules/extractors/mixdrop/subTitleExtractor");
        res.setHeader('Content-Type', 'application/javascript');
        res.send(script);
    } catch (error) {
        console.error('Error serving subtitle extractor script:', error);
        return serverErrorResponse(res, 'Failed to load subtitle extractor script');
    }
}

const mixdropMetaData = async (req, res) => {
    try {
        const script = require("../modules/extractors/mixdrop/metaData");
        res.setHeader('Content-Type', 'application/json');
        res.send(script);
    } catch (error) {
        console.error('Error serving meta data:', error);
        return serverErrorResponse(res, 'Failed to load meta data');
    }
}

module.exports = {
    mixdropVideo,
    mixdropSubtitle,
    mixdropMetaData
}


