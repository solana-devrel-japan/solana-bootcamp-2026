use anchor_lang::prelude::*;

#[constant]
// https://pyth.network/developers/price-feed-ids#solana-stable
pub const SOL_USD_FEED_ID: &str = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
pub const USDC_USD_FEED_ID: &str = "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";
pub const MAXIMUM_AGE: u64 = 100; // 古い価格フィードエラーを避けるため、100秒前までの価格を許可

// 利率計算の精度
// 利率はbasis points（1/100パーセント）で保存
// 例: 500 = 年利5%
pub const INTEREST_RATE_DECIMALS: u64 = 10_000;
pub const SECONDS_PER_YEAR: u64 = 31_536_000; // 365 * 24 * 60 * 60（1年の秒数）
