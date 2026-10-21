
const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
    const token = req.cookies?.token;

    if (!token) {
        return res.redirect('/user/login');
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Make the authenticated user's information available to routes.
        req.user = decoded;

        next();
    } catch (error) {
        // Invalid or expired token: clear it and require login again.
        res.clearCookie('token', {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            path: '/'
        });

        return res.redirect('/user/login');
    }
}

module.exports = authMiddleware;
