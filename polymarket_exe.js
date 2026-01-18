const { ClobClient, Side, OrderType } = require("@polymarket/clob-client");
const { Wallet } = require("ethers");

const HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137;

const privateKey =  process.env.privateKey || "";
const funder = process.env.funder || "";  

var poly_client={}; 

console.log(privateKey);
console.log(funder); 

setInterval(async () => {
 
}, 1000);