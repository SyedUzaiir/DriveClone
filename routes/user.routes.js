const express = require('express')
const router = express.Router()
const { body, validationResult } = require('express-validator');
const userModel = require('../models/user.model')
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// router.get('/test', (req,res)=>{
//     res.send('user Test route')
// }) (/user/test)

router.get('/register',(req,res)=>{
    res.render('register')
})

router.post('/register', 
    body('email').trim().isEmail().isLength({min:10}),
    body('password').trim().isLength({min:5}),
    body('username').trim().isLength({min:3}),
    async (req,res)=>{
        const errors = validationResult(req);
        if(!errors.isEmpty()){
            return res.status(400).json({
                errors:errors.array(),
                message:"Invalid data"
            })
        }

        const {email,username,password} = req.body;
        
        const hashPassword = await bcrypt.hash(password, 10);

        try{
            const newUser = await userModel.create({
                email,
                username,
                password: hashPassword
            })

            return res.status(201).json(newUser)
        }catch(err){
            console.error(err)
            return res.status(500).json({message: 'Server error', error: err.message})
        }

    // // console.log(req.body);
    // res.send(errors)
})

router.get('/login',(req,res)=>{
    res.render('login');
})

router.post('/login', 
    body('username').trim().isLength({min:3}),
    body('password').trim().isLength({min:4}),
    async(req,res) => {
        const errors = validationResult(req);
        if(!errors.isEmpty()){
            return res.status(400).json({
                error: errors.array(),
                message: 'Invalid Data'
            })
        }
        const {username, password}= req.body;

        const user = await userModel.findOne({
            username : username
        })

        if(!user){ 
            return res.status(400).json({
                message:' username or password is incorrect'
            })
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if(!isMatch){
            return res.status(400).json({
                message: 'username or password is incorrect'
            })
        }

        const token = jwt.sign({
            userId: user._id,
            email: user.email,
            username: user.username
        }, process.env.JWT_SECRET,
        )
        
        res.json({
            token
        })

    }

)

module.exports = router;