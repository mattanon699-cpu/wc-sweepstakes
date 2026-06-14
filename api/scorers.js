export default async function handler(req, res) {
  const response = await fetch(
    "https://api.football-data.org/v4/competitions/WC/scorers?limit=10",
    { headers: { "X-Auth-Token": process.env.API_KEY } }
  );
  const data = await response.json();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(200).json(data);
}
