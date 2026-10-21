
const express = require('express');
const userRouter = require('./routes/user.routes');
const dotenv = require('dotenv');
dotenv.config();

const connectToDB = require('./config/db');
const cookieParser = require('cookie-parser');
const indexRouter = require('./routes/index.routes');

const app = express();

// View engine
app.set('view engine', 'ejs');
app.set('views', './views');

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

// Chrome DevTools request
app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
    res.sendStatus(204);
});

// Routes
app.get('/', (req, res) => {
    res.render('index');
});

app.get('/register', (req, res) => {
    res.redirect('/user/register');
});

app.use('/', indexRouter);
app.use('/user', userRouter);

// Start the database first, then the server
async function startServer() {
    try {
        await connectToDB();

        app.listen(3000, () => {
            console.log('Server is running on port 3000');
        });
    } catch (error) {
        console.error('Application startup failed:', error.message);
        process.exit(1);
    }
}

startServer();
