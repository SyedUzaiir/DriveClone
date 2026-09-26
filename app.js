const express = require('express')
const userRouter = require('./routes/user.routes')
const dotenv = require('dotenv')
dotenv.config();
const connectToDB = require('./config/db')
connectToDB();

const app = express()

app.set('view engine', 'ejs')
app.set('views', './views')
app.use(express.json())
app.use(express.urlencoded({extended:true}))

app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
    res.sendStatus(204)
})

app.get('/', (req, res) => {
    res.render('index')
})

app.get('/register', (req, res) => {
    res.redirect('/user/register')
})


app.use('/user',userRouter) //should use /user as parent route!!

app.listen(3000,()=>{
    console.log("Server is running on port 3000")
})