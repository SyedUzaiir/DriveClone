
const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const userModel = require('../models/user.model');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Cookie settings shared by login and logout.
const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/'
};

// Registration page
router.get('/register', (req, res) => {
    res.render('register');
});

// Register user
router.post(
    '/register',
    body('email').trim().isEmail().isLength({ min: 10 }),
    body('password').isLength({ min: 5 }),
    body('username').trim().isLength({ min: 3 }),
    async (req, res) => {
        const errors = validationResult(req);

        if (!errors.isEmpty()) {
            return res.status(400).json({
                errors: errors.array(),
                message: 'Invalid data'
            });
        }

        const { email, username, password } = req.body;

        try {
            const hashPassword = await bcrypt.hash(password, 10);

            const newUser = await userModel.create({
                email,
                username,
                password: hashPassword
            });

            // Never return the password hash to the client.
            return res.status(201).json({
                message: 'Registration successful',
                user: {
                    id: newUser._id,
                    username: newUser.username,
                    email: newUser.email
                }
            });
        } catch (err) {
            console.error('Registration error:', err.message);

            return res.status(500).json({
                message: 'Unable to register user'
            });
        }
    }
);

// Login page
router.get('/login', (req, res) => {
    res.render('login');
});

// Login user
router.post(
    '/login',
    body('username').trim().isLength({ min: 3 }),
    body('password').isString().isLength({ min: 1 }),
    async (req, res) => {
        const errors = validationResult(req);

        if (!errors.isEmpty()) {
            return res.status(400).json({
                errors: errors.array(),
                message: 'Invalid data'
            });
        }

        const { username, password } = req.body;

        try {
            const user = await userModel.findOne({ username });

            if (!user) {
                return res.status(400).json({
                    message: 'Username or password is incorrect'
                });
            }

            const isMatch = await bcrypt.compare(
                password,
                user.password
            );

            if (!isMatch) {
                return res.status(400).json({
                    message: 'Username or password is incorrect'
                });
            }

            if (!process.env.JWT_SECRET) {
                throw new Error('JWT_SECRET is not configured');
            }

            const token = jwt.sign(
                {
                    userId: user._id.toString(),
                    email: user.email,
                    username: user.username
                },
                process.env.JWT_SECRET,
                { expiresIn: '1d' }
            );

            res.cookie('token', token, {
                ...cookieOptions,
                maxAge: 24 * 60 * 60 * 1000
            });

            return res.send('Logged In');
        } catch (err) {
            console.error('Login error:', err.message);

            return res.status(500).json({
                message: 'Unable to log in'
            });
        }
    }
);

// Logout user
router.post('/logout', (req, res) => {
    res.clearCookie('token', cookieOptions);
    return res.redirect('/user/login');
});

module.exports = router;
