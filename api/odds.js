export default async function handler(req, res) {
  const response = await fetch(
    "https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/odds?regions=eu&markets=outrights&apiKey=" + process.env.ODDS_API_KEY
  );
  const data = await response.json();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(200).json(data);
}

