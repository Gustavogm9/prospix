$ErrorActionPreference = 'Stop'

$accessToken = Read-Host 'Supabase access token' -AsSecureString

try {
  & "$PSScriptRoot\activate-prospix-evolution.ps1" -AccessToken $accessToken

  $expectedPhone = Read-Host 'CEO test phone' -AsSecureString
  try {
    & "$PSScriptRoot\send-prospix-ceo-qa.ps1" `
      -AccessToken $accessToken `
      -ExpectedPhone $expectedPhone
  } finally {
    $expectedPhone = $null
  }
} finally {
  $accessToken = $null
}
