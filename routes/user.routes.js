const express = require('express')
const router = express.Router()
const { body, validationResult } = require('express-validator');
const userModel = require('../models/user.model')


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

        try{
            const newUser = await userModel.create({
                email,
                username,
                password
            })

            return res.status(201).json(newUser)
        }catch(err){
            console.error(err)
            return res.status(500).json({message: 'Server error', error: err.message})
        }

    // // console.log(req.body);
    // res.send(errors)
})


module.exports = router;