const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const databasePath = path.join(__dirname, "twitterClone.db");

const app = express();

app.use(express.json());

let database = null;

const initializeDbAndServer = async () => {
  try {
    database = await open({
      filename: databasePath,
      driver: sqlite3.Database,
    });

    app.listen(3000, () =>
      console.log("Server Running at http://localhost:3000/")
    );
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

const convertTweetToJson = (dbObject) => {
  return {
    username: dbObject.username,
    tweet: dbObject.tweet,
    dateTime: dbObject.date_time,
  };
};

const tweetinformation = (dbObject) => {
  return {
    tweet: dbObject.tweet,
    likes: dbObject.likes,
    replies: dbObject.replies,
    dateTime: dbObject.date_time,
  };
};

//authenticate middleware
const authenticateToken = (request, response, next) => {
  const authHeader = request.headers["authorization"];
  let jwtToken;
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_KEY", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

//register user API
app.post("/register/", async (request, response) => {
  const { name, username, password, gender } = request.body;
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const user = await database.get(getUserQuery);
  if (user !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      const postUserQuery = `
            INSERT INTO
              user (name,username,password,gender) 
              VALUES (
                  '${name}',
                  '${username}',
                  '${hashedPassword}',
                  '${gender}'
              );
            `;
      await database.run(postUserQuery);
      response.status(200);
      response.send("User created successfully");
    }
  }
});

//login user API
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `
  SELECT
    *
  FROM
    user
  WHERE username = '${username}'
  `;
  const dbUser = await database.get(selectUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordValid = await bcrypt.compare(password, dbUser.password);
    if (isPasswordValid === false) {
      response.status(400);
      response.send("Invalid password");
    } else {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "MY_SECRET_KEY");
      response.send({ jwtToken });
    }
  }
});

const getUserDetails = async (username) => {
  const getUserIdQuery = `
  SELECT
    *
  FROM
    user
  WHERE
    username = '${username}';
  `;
  const user = await database.get(getUserIdQuery);
  const userId = user["user_id"];
  return userId;
};

/// get tweets of users

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { username } = request;
  const userId = await getUserDetails(username);
  const getFollowingTweetsQuery = `
    select user.username,
    tweet.tweet,
    tweet.date_time
    from (tweet inner join user on
    tweet.user_id = user.user_id) as T inner join follower
    on T.user_id = follower.following_user_id
    where follower.follower_user_id = ${userId}
    order by T.date_time desc
    limit 4;
    `;
  const tweets = await database.all(getFollowingTweetsQuery);
  response.send(tweets.map((tweet) => convertTweetToJson(tweet)));
});

/// get user following

app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username } = request;
  const userId = await getUserDetails(username);
  const getUserFollowsQuery = `
    select user.name
    from user inner join follower on user.user_id = follower.following_user_id
    where follower.follower_user_id = ${userId};`;
  const users = await database.all(getUserFollowsQuery);
  response.send(users);
});

/// get user followers

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username } = request;
  const userId = await getUserDetails(username);
  const getUserFollowersQuery = `
    select user.name
    from user inner join follower on user.user_id = follower.follower_user_id
    where follower.following_user_id = ${userId};`;
  const followers = await database.all(getUserFollowersQuery);
  response.send(followers);
});

/// get tweet based on ID

app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { username } = request;
  const userId = await getUserDetails(username);
  const { tweetId } = request.params;
  const checkTheTweetUser = `
  select * from tweet inner join follower on tweet.user_id = follower.following_user_id
  where tweet.tweet_id = ${tweetId} and follower.follower_user_id = ${userId};`;
  const tweet = await database.get(checkTheTweetUser);
  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const getTheTweetQuery = `
      select tweet.tweet, (SELECT
      count(*)
    FROM
      tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id
    WHERE tweet.tweet_id = ${tweetId}) as likes,
    (SELECT
      count(*)
    FROM
      tweet INNER JOIN reply ON tweet.tweet_id = reply.tweet_id
    WHERE tweet.tweet_id = ${tweetId}) as replies, tweet.date_time
    from tweet
    where tweet.tweet_id = ${tweetId};`;
    const tweetsInformation = await database.get(getTheTweetQuery);
    response.send(tweetinformation(tweetsInformation));
  }
});

/// get likes for a tweet

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const userId = await getUserDetails(username);
    const { tweetId } = request.params;
    const checkTheTweetUser = `
  select * from tweet inner join follower on tweet.user_id = follower.following_user_id
  where tweet.tweet_id = ${tweetId} and follower.follower_user_id = ${userId};`;
    const tweet = await database.get(checkTheTweetUser);
    if (tweet === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const getlikesUserQuery = `
    select user.username
    from user inner join like on like.user_id = user.user_id
    where like.tweet_id = ${tweetId};`;
      const likeuserInformation = await database.all(getlikesUserQuery);
      const likes = likeuserInformation.map((user) => {
        return user["username"];
      });
      response.send({ likes });
    }
  }
);

/// get replies for a tweet

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const userId = await getUserDetails(username);
    const { tweetId } = request.params;
    const checkTheTweetUser = `
  select * from tweet inner join follower on tweet.user_id = follower.following_user_id
  where tweet.tweet_id = ${tweetId} and follower.follower_user_id = ${userId};`;
    const tweet = await database.get(checkTheTweetUser);
    if (tweet === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const getrepliesUserQuery = `
    select user.name, reply.reply
    from user inner join reply on reply.user_id = user.user_id
    where reply.tweet_id = ${tweetId};`;
      const replyuserInformation = await database.all(getrepliesUserQuery);
      const replies = replyuserInformation.map((user) => {
        return { name: user.name, reply: user.reply };
      });
      response.send({ replies });
    }
  }
);

/// get tweets of an user

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const userId = await getUserDetails(username);
  const getUserTweets = `
  SELECT
    tweet,COUNT(*) AS likes,
    (
        SELECT
          COUNT(*) AS replies
        FROM
          tweet INNER JOIN reply ON tweet.tweet_id = reply.tweet_id
        WHERE tweet.user_id = ${userId}
        GROUP BY
          tweet.tweet_id
    ) AS replies,tweet.date_time
  FROM
    tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id
  WHERE tweet.user_id = ${userId}
  GROUP BY
    tweet.tweet_id;
  `;
  const tweets = await database.all(getUserTweets);
  response.send(tweets.map((tweet) => tweetinformation(tweet)));
});

/// create a tweet

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const userId = await getUserDetails(username);
  const { tweet } = request.body;
  const postTweetQuery = `
    INSERT INTO
      tweet (tweet,user_id)
    VALUES
      ('${tweet}',${userId})
    `;
  await database.run(postTweetQuery);
  response.send("Created a Tweet");
});

/// delete a tweet

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    try {
      const { username } = request;
      const userId = await getUserDetails(username);
      const { tweetId } = request.params;
      const getTweetQuery = `
    SELECT
      *
    FROM
      tweet
    WHERE tweet_id = ${tweetId}
    `;
      const tweet = await database.get(getTweetQuery);
      const { user_id } = tweet;
      if (user_id === userId) {
        const deleteTweetQuery = `
      DELETE FROM
        tweet
      WHERE tweet_id = ${tweetId}
      `;
        await database.run(deleteTweetQuery);
        response.send("Tweet Removed");
      } else {
        response.status(401);
        response.send("Invalid Request");
      }
    } catch (error) {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

module.exports = app;
