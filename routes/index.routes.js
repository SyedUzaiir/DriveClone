const express = require('express');
const router = express.Router();

const authMiddleware = require('../middleware/auth.middleware');

router.get('/home', authMiddleware, (req, res) => {
    res.render('home');
});

module.exports = router;
