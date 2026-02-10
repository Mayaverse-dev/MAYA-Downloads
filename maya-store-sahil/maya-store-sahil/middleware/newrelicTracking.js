function trackPageView(req, res, next) {
    // Only track if New Relic is loaded
    if (process.env.NEW_RELIC_LICENSE_KEY) {
        const newrelic = require('newrelic');
        const isApiCall = req.path.startsWith('/api/');
        
        const eventData = {
            email: req.session?.email || 'anonymous',
            path: req.path,
            method: req.method,
            userAgent: req.get('User-Agent'),
            timestamp: Date.now()
        };
        
        if (isApiCall) {
            // Track API calls separately
            // console.log('[NewRelic] Recording MayaApiCall:', eventData.path, eventData.email);
            newrelic.recordCustomEvent('MayaApiCall', eventData);
        } else {
            // Track page views (HTML pages)
            // console.log('[NewRelic] Recording MayaPageView:', eventData.path, eventData.email);
            newrelic.recordCustomEvent('MayaPageView', eventData);
        }
    }
    next();
}

module.exports = { trackPageView };

