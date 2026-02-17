use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Bank {
    /// Bankの状態を変更する権限を持つアドレス
    pub authority: Pubkey,
    /// アセットのMintアドレス
    pub mint_address: Pubkey,
    /// Bankの現在の総預金トークン数
    pub total_deposits: u64,
    /// Bankの現在の総預金シェア数
    pub total_deposit_shares: u64,
    /// Bankの現在の総借入トークン数
    pub total_borrowed: u64,
    /// Bankの現在の総借入シェア数
    pub total_borrowed_shares: u64,
    /// ローンが担保不足と判定され清算可能になるLTV閾値
    pub liquidation_threshold: u64,
    /// 清算時に付与されるボーナスのパーセンテージ
    pub liquidation_bonus: u64,
    /// 清算可能な担保のパーセンテージ
    pub liquidation_close_factor: u64,
    /// 借入可能な担保の最大パーセンテージ
    pub max_ltv: u64,
    /// 最終更新タイムスタンプ
    pub last_updated: i64,
    /// 利率（basis points: 500 = 5%）
    pub interest_rate: u64,
}

// チャレンジ: 複数のアセットに対応するために、"all_deposited_assets"と"all_borrowed_assets"を保存するようにユーザー状態をどのように更新しますか？
#[account]
#[derive(InitSpace)]
pub struct User {
    /// ユーザーのウォレットの公開鍵
    pub owner: Pubkey,
    /// SOL Bankへのユーザーの預金トークン数
    pub deposited_sol: u64,
    /// SOL Bankへのユーザーの預金シェア数
    pub deposited_sol_shares: u64,
    /// SOL Bankからのユーザーの借入トークン数
    pub borrowed_sol: u64,
    /// SOL Bankからのユーザーの借入シェア数
    pub borrowed_sol_shares: u64,
    /// USDC Bankへのユーザーの預金トークン数
    pub deposited_usdc: u64,
    /// USDC Bankへのユーザーの預金シェア数
    pub deposited_usdc_shares: u64,
    /// USDC Bankからのユーザーの借入トークン数
    pub borrowed_usdc: u64,
    /// USDC Bankからのユーザーの借入シェア数
    pub borrowed_usdc_shares: u64,
    /// USDCのMintアドレス
    pub usdc_address: Pubkey,
    /// ユーザーの現在のヘルスファクター
    pub health_factor: u64,
    /// 最終更新タイムスタンプ
    pub last_updated: i64,
}
