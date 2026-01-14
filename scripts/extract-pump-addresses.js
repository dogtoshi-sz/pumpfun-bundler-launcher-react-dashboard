const fs = require('fs');
const path = require('path');

// Full log text from user (all 3 sessions combined)
const fullLogText = `[Worker 9] ✓ Found vanity address!
  Address: 6m2ZiUzPbtj1eZbjzc1mUKQs1aS4WJnKH6ENsxhVpUMP
  Private Key: 2pBAfHn6VywgwtKyk3pCTvEAuTABdK5CoYRRjMHbrFJPT8fbDoWFSKbQYRFQt4QwdoKAnNA6uogwLKQQJ99HrQJ5
[Worker 15] ✓ Found vanity address!
  Address: 34XUd9rTXRXSzEtTHQp8oxVGuS99hBA65aQvDQNmPuMp
  Private Key: 5puPQW42kYmD3xAfQWwYG3VSjJb4gveEoWD4Lsu4DXswRmqLXH3hg5Qa5B9CofaU9ghfUzKQZF9yH1nzGy3jc2mc
[Worker 12] ✓ Found vanity address!
  Address: Ge5gLjdfKTd61CTgNpfCoJxdwNDCf3wLLSVWKnKkpUMp
  Private Key: 5rBBGq84yoxEXMpYoQmfsgz5PeVPdc2R3bqGhJPgBX8EDs6yvCmiRzxJWyu63rfPbHFgL2dEdk4fnGbFvXrPKajL
[Worker 21] ✓ Found vanity address!
  Address: AVf1w5gEH2S8x55rEy3oZWbEmhVKmXPmymecivGbpump
  Private Key: 4ajZD1PGoibnzYXSG16GdMDbmj4fmyxwoDXVyMdEYnS2fiUVVCeZg3CbYEAmbppNW9ht8HAzEmsue4R2KsYFFEi2
[Worker 12] ✓ Found vanity address!
  Address: pQNLp9R5MrTb2DwNA3wX3WRwKgBwTf63fGAorCbpump
  Private Key: 2puSctKxUcLbAGgcKpfZVSQZ31pV8jdVB9Pdb97wydKRQrTyaMWfsUVHgLdrvaeTpFixPFt3NKaZH1LF5JR5BQk6
[Worker 0] ✓ Found vanity address!
  Address: jZxGv9mrouM6caSN2A2wMTUsZNZMTVp72mxf3Fvpump
  Private Key: 3gBibVprQsQDEwZHF5acbALDFYT6ioaKao2HucH8Ez8Tzq9iSJ1mu8K5qBGBMKJatN7gRPCzKXhHifjnUfboCJEr
[Worker 2] ✓ Found vanity address!
  Address: ANqYmYSN32cNpF14J1iwftt61vQVwYKcuKFdBddupump
  Private Key: 2gMw6UYKCako7zvmWHorQnSHN5DSgUieAEokK6UW5X1JwTpeWa4SR2ug5BDccrNmY6VWe9u7mW5Drq6gj2L5u2kn
[Worker 4] ✓ Found vanity address!
  Address: EFUF2ZkJLiDuaEXuiweyKwdYLKeo9AygmBA8T5WGpump
  Private Key: 2LbiKnqsp1PSLF8VL7Ly6hvNhKsKY9uEM8dpZPMjVds6UESKcwXPDHUX3vMvHys3TpycyPqi1wuzw68PUEPNDsYa
[Worker 12] ✓ Found vanity address!
  Address: 8hvmzJSExt7yob8Fi43N8cLF2Sjd1zhMJASRqX1Cpump
  Private Key: nCF6ikqabjURKvKLviVzGCVfdvVLudB9jEoD4aoMcLQryRz4fCKms3HD5CENrwDLxGVbb1MpiC85GWXwqHFGHj4
[Worker 14] ✓ Found vanity address!
  Address: 5ZBgVN1rWVFXF5Ufjix94xbh7fcR319dkGnaZo8npump
  Private Key: ePnFVSXERHtXnpaPd3H6DrP7dnT3odVXek1HV8wPh6YnhuK5CRdpa4AtoxRoZ4tjncoq2jpgEuyEkZgQhs9ZKCz
[Worker 12] ✓ Found vanity address!
  Address: AFX2z5STggUgFp6L8AYoSNdpUDnc3eddVREUUroapump
  Private Key: dkzP4KbzZJ31kUkhURGpVFs6meVKEjmTp75rjgg4VBtfQkSfhXKUABGcm4XMHyNJ5qNYt2927jWHUUY8GAEhyxS
[Worker 7] ✓ Found vanity address!
  Address: E7R3mXTtpo8Rg7kP3F8WxLrscZqgeZyfKtt7WM8Mpump
  Private Key: 2qYg6VpPuZGg76arUHUTBbcLjkxCaSthBteoJErJSmzVcafayWtwbF9m5sJDWdVRHyJoEVNVXAxcPucsfScuWGkn
[Worker 0] ✓ Found vanity address!
  Address: Ay4ay1njzKqHYdUw2GDVfznY6crX1Rvrb7ztFY6Epump
  Private Key: 4qP3v6p316XxcNJj1SKQPy6nqfQW3B3zuVqy8vFYqg6AfMy43evqg99rVLnLKzeAUiQSeMkqxtjw6FTrWWbKqnVt
[Worker 19] ✓ Found vanity address!
  Address: CSGADD3jETHdQ3pYeyHdP9CfzzoqowS5maqzB3sQpump
  Private Key: 53WgrV9q823oaERTEKeGmQhopru1fQUG7hGWdtg6r8MMrqLSSvvDq7FTVjqsWSwG3SmZxbZNeU6qSTrC4X3SK3ci
[Worker 20] ✓ Found vanity address!
  Address: 6XXbmJy643WFdVuSwqBpJ6dB14hqSodMwQzb5FQtpump
  Private Key: 4Jr2HNF5TT9UZzhWB1wE5GegXK5z7e4j7JsDWcAptN54ytjuGiTQVyCwuKEy2Vn8ajHTod14Xy9gvWZDvkZXMcHL
[Worker 17] ✓ Found vanity address!
  Address: BsNUmyTCiQx57Fq2tbPP8xyZ7AL4Bmcj1PftBtscpump
  Private Key: AeHpsjDvAxS57jgxmpd42BiaoLvqHAtnwtCJiQYm1ciXYSsQ6bkraVfmvbPeQkH61T1BXL3CqPMvsy2rE6xyjJn
[Worker 1] ✓ Found vanity address!
  Address: 6K1s9y8Ryaxnc9ZayHNM5SQRqwac3KQBwkVophjQpump
  Private Key: 5pZv5c2GpvSTjZ74bMpYbZjAh1tBEFmNRnmCiQX9eyER1sAF5eWNpgqpxgZJZqa8864PBQTx5fCMPih6JaaMTobc
[Worker 15] ✓ Found vanity address!
  Address: FRmR5bKYRbLXppr83Y8JGxCLkqUez4tkyUhQiCmjpump
  Private Key: 47kc5mx9J2BppEJ26LDVURqi1b7YAsJ6mefA3EF6qPQNpkyVxdQTSEMiotr635FFx7yRxtd8PD1UQS6tgwiDNBzv
[Worker 19] ✓ Found vanity address!
  Address: Ahopr9uenrwWZdtDytqcoCktFNHuV34nRKgLEWESpump
  Private Key: H3KR8FbKDEpBYD58rLHRs7C3Af5DeAdnXpCqefQmnUhgN9Po6CiW33HaHPekRVKwL2TdCfc5idFWFqqFpeE7ShC
[Worker 7] ✓ Found vanity address!
  Address: AVAq112PhJiw11fkAaS5vKcfQ46aMmGLGZmrCxPypump
  Private Key: 2JWd4N3tYgbwzuCQ9ZUFioGsSZZJuLKSFcUTPHwikV33v6mNRrrzYpc31VVsnFNVmUXLe72ECQaRzEqbUzvJkdCS
[Worker 0] ✓ Found vanity address!
  Address: 7rowNUaWAumM22DfqU8vRmsi2KGQq1iiXp8JY92Gpump
  Private Key: 56KWKeph8JwSjUszRL6CtEAinVxNrZzoZBAfihzjvKuck3xtrzEUhxXAteu9iNedkcaf4TaXUcnx8fh7FCanxEnJ
[Worker 6] ✓ Found vanity address!
  Address: 8sqvomfQpZ4tjuuLcndJfEJEtwGfKNB2p6jkYCAdpump
  Private Key: 2rRCjUuzfs9svgGwLtp4PwmyZd3VrpuwL1ECYcMiEWwxpkQJgag9rcMLkesJnmJCcoi68GuQfDvbdrTCXfgGfDVg
[Worker 8] ✓ Found vanity address!
  Address: HKpdCdpzfx8dWPiBWNdL1J4PNRinJ3P4cueQ5NT7pump
  Private Key: 4hCn5JYsz977GZrvGJRNMnYmpxLL6fco7ibxRLLETghwW7wtrfJpi2RHB5boxR1scBXSc7EVR4yeSokWbDZJFmKk
[Worker 8] ✓ Found vanity address!
  Address: Hr6VkdpHytMDw5L5bSVFNofsxms3dUTGT8PsDQLApump
  Private Key: 3sPZiRCxNZ5bimAfqoCSKYepqRRpkDhYqkNnVx3Jc3pzL9WXvyPT7z5EJ4WzgsyCPWZPViy8sQAdTCY8iBQEn5vv
[Worker 8] ✓ Found vanity address!
  Address: BHaGprvDfE1eDh8VZvBk6LJ3VjQsYwfFnewfoqXSpump
  Private Key: 5SfHBMPrXYJchuLzGaWrF5pJJ9XqMkDDnzo7BZ2J67gwq4mzDgQ7bCgkoLZxBY5DnjGbQGRbKENAQNLZrK8ZWa3Y
[Worker 13] ✓ Found vanity address!
  Address: CbhuHXCP2dpSMZ47h5hZtUyUUxK1ZqShAfcbYvLDpump
  Private Key: 39DNdhzGrRg2c3WMKWSmXnedqVp9Bch83UHYk8KHdgmSFt8N1noNvbJNF7mhm44wvZWju6gYSY8CUMCqaNpGQdeN
[Worker 12] ✓ Found vanity address!
  Address: U5DLDzk8v9z9mLNCHwS4dKjF59EA2vJP5Nn84WLpump
  Private Key: 4arY1E8eiZH5L8BfoFdRJ7ESvTYKqYJHyjCtiZUXeiHDxiL3DiP3DVvCFj5PEb7cDVuQGSemoYDiT1mwubSzVRc2
[Worker 18] ✓ Found vanity address!
  Address: 6HmSGeGBoyrhfd1c4TE6DiTKR7397muuyYWCN44vpump
  Private Key: 2HRatTeHQepwbm26fv7TSK1GwSL83xZ8B8ageT3iTPbjsUd57FhH4X6jvy945bnp3wDcNWB46dEXsDdAaCvAJoYi
[Worker 4] ✓ Found vanity address!
  Address: 4rq8MbPvsbodpqbE7PcZQ5WYb168QZv9WveyGDPzpump
  Private Key: 2D9QHzfngFAW8APjueWARLLYLDcuscrTZNuyZC2CQmzgSFLPPbW3H28Ft5TzE8PZyX42JfC6kDGWBj5sMEhsZwan
[Worker 2] ✓ Found vanity address!
  Address: HbneETurEEf7Lv33LFQF2tE8VqdRiqjdZCkcFQAxpump
  Private Key: 4xcNW3EToAErJyXR2aAqfKh9RSNwPBqED7DSkSZw8BaJNuKqJ5znBoRNYZJwuxpKMFPT7sLkad3zfWkJsCJcCNBY
[Worker 20] ✓ Found vanity address!
  Address: 745Q5eokVrATGmYCXWv9RvDgN2pXrBTsqfjxudPfpump
  Private Key: 5NNbRydPsDoPdiUs1UJ5Feb4rXtQgtTGbwpK4oYGdLGW5ffJdSrDw8gNdgxZLHt6M4CL4y4bQkKAVBzHhoEm8y3c
[Worker 19] ✓ Found vanity address!
  Address: 8ZTQ2ESK3RT62AP6sCoX1AFvNp2BVigTB2cUPf2Qpump
  Private Key: 48TYJWQW6jYQmqFby8aSfh21xWKLej6VxtP8RGotXsu4VRaMSckSBPxbm9Bz949ZkKKoFi8opgZeG59DcvNQhvV4
[Worker 16] ✓ Found vanity address!
  Address: EvHYcjMQcFsWJDUpP1L7DZQs18ig1Ybu1emeY9vepump
  Private Key: 2oJtaYGEnmSaGgLjmrBbyR2hyPB61Bp1kXLbH8c3pwDLSAtyJqrNv3oswsSfSQi8NCM3UDPbxykXWBAy1XsPwqZp
[Worker 0] ✓ Found vanity address!
  Address: 3tzCefzmcPbtKpH22xo2zTCTBrGQhqjV2TWjwVaEpump
  Private Key: 5HubgjMJXguSDnzwWy7Jg5CtoSGVtSeJ6XJ78pcvSNFVEACNB1JX498BmgZoLoNdMSME3Zs3cyZkK7rUnEb9F5Xt
[Worker 7] ✓ Found vanity address!
  Address: 3cmuFr91JhxAfmgMJA3CsNpwKqX1f9EgsXFQtpuhpump
  Private Key: 5sD4uzNuy4DK73BzHEpgKYbzWMkoECgk9CFRbtF1a2CvSViBJX5G8S1vKtuePrrXkrUNRWsKn4NyhWZRC2h6izMC
[Worker 13] ✓ Found vanity address!
  Address: Fdg72BoPR39CHPG3ASRiMJ7nyU7Z6iby3GvNu7CWpump
  Private Key: 3qs1RmEJe8EDnnXAUkZhnADgLtdTgaKMceL321cH4SvyTZszGMPDWtvQ7dV5UexRhk9RgoQuz6rhXMmNvNGJbyG
[Worker 4] ✓ Found vanity address!
  Address: 7aeQ7k8TsWQoDjfTLx5izvKXsU762T6XU12dyz3Spump
  Private Key: 5uVBjPfAZ3GLaHZDygw9WCocRTC3WxsiyuyEAq7eMQWLqebNQNNyWeAzKt8syyvuwYYQUzL1Vdhpjfuw5AciYjGA
[Worker 19] ✓ Found vanity address!
  Address: Fvt3HctEimaVT8tgfJW5evFeeGVDXz6geR7z22k7pump
  Private Key: vPJ4nwNpLH99BdStkqAMEqe98Z5ipYEz6qgGaE9aTVsHWq46M3XwLd1FvmyWEPHhoF9E8n66vnNzfzwPqwfeDdG
[Worker 5] ✓ Found vanity address!
  Address: DWg4mNBeozmPdU8ThKcmNXTxkrEpixckZZ779K9fpump
  Private Key: T1BSCLGQoQPsCWxVVkSvbBytjmMdjXXMhRqQNx8w7NSa13Bfr8cXsJYVN6qqGKybUpw5HyKsoZ6opCnS47Ddtva
[Worker 17] ✓ Found vanity address!
  Address: HpM5sGaXsyvJ5DVBDoszdNtZuW5X2TCdLr9cM2egpump
  Private Key: 5FXTc7jxQZq8ecUkzNkv9oF68cZVdShcUL29Q6CeaTWidLWqswAKr6HrxRxZuxkC5MVEwnaVJzPwqAPFypA8zVXk
[Worker 6] ✓ Found vanity address!
  Address: FPZ8QZnYB4FCqrbyDiinWrqAVudBrfR5ewckRnYupump
  Private Key: HJK4y9zb1rk8W6NsEVMmj5jAiZBgdqFU635Hxb57QC6dcSGpeEM2EcDo7khqsT7jfknD9nEdR1zyR2eegEBhxpE
[Worker 11] ✓ Found vanity address!
  Address: 3qkyyhnHiaN41peuahHbjd6ZRKEoiJqv3uRCB4nPpump
  Private Key: 57PbvLUQSNieUrJuTLxTtU7aLKZ9uPwqp1u5FzDQrdYSEQNosZLU8sxVjLYLY2wALLsbLRSbYWXphNpQFxUqmV3k
[Worker 11] ✓ Found vanity address!
  Address: DZ6MwC6j7XyqxgCcSxe3G8qP21Qw5TKxs9RS9bqzpump
  Private Key: 677p7W86nwHpozzNg2b1DiuFwV4VEPS2dVwqYv7GxYpNaCMqFoJ7FLui721jaAHLsuojhBh5MdfZwxUnA7QKbQuC
[Worker 19] ✓ Found vanity address!
  Address: B1npmyAdasRvFWEnFZbz8SBmQLuSRegrJg3E4Bq1pump
  Private Key: JNts9uhfGDCqux5ejRMp91bzYbLGdLt9qitACrj7Jv5j2ykrWeHCra5pv6N2Xe21vyYbc54YoojSCVAkBZ4vDjc
[Worker 3] ✓ Found vanity address!
  Address: AJh7Akn27mYnX69UtCpkkTqAu6d8xk1KSrcVRt2Dpump
  Private Key: eHbHzSJfnrZZCgZv9fNnwGaQ3cfuxGU26tEwh2KPJoKECnz44a3ULpzzK6dG123oyBUZLKozaphwAMdSj4vn4FY
[Worker 17] ✓ Found vanity address!
  Address: HVrN1bv6VjJxLuS7xmvFPKcMoNGnxdSvUcvxL8FVpump
  Private Key: 3KP8hrcMveP2eQTgG8RSR9zjrvaibvnkbcZCcySJbMYtLZG4PMYokzoHM8DYYuYB5CRehj2EAkLhS49CgzPQikv
[Worker 16] ✓ Found vanity address!
  Address: 8M5V1M44JkyoWXnUKZXyisLWcgdDcXqX9T4BDv5Mpump
  Private Key: 2w3d7KJfNwY25AePqVUua1rzEG8RRkBxy4qcD3qEirW1jpbNpY4fok4UzBp8LTHVHZbkxRTfBThPLJhYNj53gtv
[Worker 11] ✓ Found vanity address!
  Address: 635k7HMcTBzVG1xjw2JNeHvY8RCvkv8QVqc1WXTxpump
  Private Key: 3s9QM6QzXWsd7S9dtTiFEsiwqemP6s2ANYe9AyXmxG63M5rhKxR19gZVS2iV8PYQXqppwGb9mxRc2CJdR2zNmmQA
[Worker 17] ✓ Found vanity address!
  Address: 3M1akygT64smyczJAg7GTEKqGf76SRvV7cXdEwArpump
  Private Key: 31V9hgpuQyATcprMMMjAw17EhHT1TFfZ9ZhjuSWctwcgAqRzbFwXqzmjEviJM9it6tU8BVtoYJv9yFVNLhRdiT8S
[Worker 4] ✓ Found vanity address!
  Address: 7MGDkFReVhsK2ChCXyZESVbBwvbitv67uBa9axkpump
  Private Key: 2jBXhKxBBAeJGrNEcxQo5LF449KFxDPnfmZgwGoduds7LshGsqJfP7MhCYSRTgCoZ77uap37tVCwzYYib4C9F8Si
[Worker 9] ✓ Found vanity address!
  Address: H7KKozNn6M1AjoH4miwqA9ULbvP17ginN7bFpd53pump
  Private Key: 2UPLnFJSPEeHGrUCVLwEmDeu28Bp1ovTxVE8CAuqKSJpGM2mc1b4cnapDYNF73WQa3f9TCsYdCe93UsrHREwQRR8
[Worker 7] ✓ Found vanity address!
  Address: EYPwCnZZhJ7KC8L8t787fc29bWA8Z7CjM6gHoqeMpump
  Private Key: 5HifoM9i9ksTZeMnwAgRkKZLGJv6c5RVR1JVYn8tYWKT2kHqYDa5Nv7g4hpeHs5vfwWrCwCcNei2xE4n1xbvpWLe
[Worker 21] ✓ Found vanity address!
  Address: DVizjYuodQT9jhHueznzT4nKLB7cKAsobMLPocrVpump
  Private Key: 3Pckvy8trFCUrmUkjN3kdjKNWzxzKsDbxfMbXypUt3TQRrXXA5yJYCHPpQ8p6nfS7v9obRCZeFUoGghJXQru6WsY
[Worker 6] ✓ Found vanity address!
  Address: 3eWR1kemkMSqbcsFiBXpvW71aes2VADzWoCf53NApump
  Private Key: 2sRndoBxm5TM2sS2u5k9LKRnjPkAb2anZvsBvi57Tiz67S5nsf5rd7YR8Yv9r6uTmvafTkFwTGWo7AECfoZEVehC
[Worker 9] ✓ Found vanity address!
  Address: Dtm1CUKUEmKNGRnz9qQ3qkySq3MBLkqG9ouSGx7Hpump
  Private Key: 48gGTRoJWrjnuqpb4cdYwUQwxWQpuWWmCRTg7XnX9MnqwW3EqAgmkxHcKnjXj4Gi75NGkewowD1xaKiAbpg4Dp14
[Worker 19] ✓ Found vanity address!
  Address: 9bQBrR4PrxNB6PWBdPFDPbDTAfYsdGJ5P4jux8Czpump
  Private Key: 5CnQWYTxgFoyC4ygxtMsizNbikNVMytqVWDwjHFLZYKhwfcQMvN4z62AVRCUDgybL33a7Zhzf85CVHi6JeEraZNe
[Worker 0] ✓ Found vanity address!
  Address: AhsGyEiuk2Z9jMWr6qbpVjtdPDStmwLNGzZrdoZApump
  Private Key: 2gbTzhyheueihef9dGYJoFSaJrhXEKxSoNie2Wyh59FKTHB8kGBEV42aejk7SmCxhpBhJbexXyKNMWaTe3om4S78
[Worker 18] ✓ Found vanity address!
  Address: 3xpiHN8YQmUE5cx2UkabUshe5jbw9ZXQEWCjNR7fpump
  Private Key: r2PsAfPanFEXU7cDUxVdt9zQXyDrX1jqFEZAqRvELiQTC2Gc7GKnSqJKtTuZozwnMY6S3s55WYjyuosGKsv1etW
[Worker 15] ✓ Found vanity address!
  Address: 8ZVGUWkLBvFYLVKrCPC5VD8S6j8jkcUETB1EhN9gpump
  Private Key: 3sLhM4upqJTYvLSHeiZntCkQXjNFFGsV8hLLDpBRuHE1bBLBTFGZVfQxCfyGXYeXCguvniprvY8YX1sCHmWr9wR8
[Worker 4] ✓ Found vanity address!
  Address: CnkzEp1XaTKdy8KNeW2CST1fjT3Q8aCCbzrNd3Hipump
  Private Key: 3AWbGTTtm4EYffKGZkBLkLCkM4y8RLRjm1WhNXwyn5KdnyKz4VfEjDXtXC4d3DT9WmdFJqvRk9WvtYbMFyK3mnFY
[Worker 16] ✓ Found vanity address!
  Address: C4ntbDR5omggxVByWRWt2xKQ2eKh3fAmG24KnBi5pump
  Private Key: ZTULb5iDPQpRnMp3teuSpQLQheTSPJDNCqYaCZaLVu3CmdZLzTW13nQu4txB3rWUKqY2bYKouNNcAYttBbu9eb8
[Worker 4] ✓ Found vanity address!
  Address: 6AsPLoJo5o9KhFRDLyVmMTaveFbtCVFfj4c5NW8pump
  Private Key: 4VJYBmP3337BoouHUQp5rqQDEVtaKN73uaazahPwKGW6NPayP5Ri5EzU2Uo2va8oFo6UdnkEhdFx9UAqaH2SLyTt
[Worker 14] ✓ Found vanity address!
  Address: 9CLUy2qVJ59n34bFYiVZRaJxn4Xgxs6bzdAs1iGHpump
  Private Key: 4TRaddBbPMmTLePEPK2tq4qzpet4VWbXVnRCJTe5aKhX45w2NUA3zsaXRAvU2f3C9YDRqLcDzzSJwfyEFJLHpLZC
[Worker 17] ✓ Found vanity address!
  Address: FnEkJpjccXoHrVdP7gPGddPvc53jexKbL6ZMy8Tbpump
  Private Key: 44NN8So3TrD7w4ZeqfQPnGo1XfZa487fZnaZNGymzKLZwkfUUckrtAHwikE5BZv16vvoduhjqQNtABvGtudDMBRx
[Worker 16] ✓ Found vanity address!
  Address: G2cvkpF6ycsxetjvCGrD3cxL5rgCBfXgUz9RJdb1pump
  Private Key: 3uBZAuK5cHgza5aNqdLZxFmSxVfv3udQ81eTinV1K4oogjf1EdNCPoxCeM5jyJ22pqfTAdgxG217EApUJHsqKRae
[Worker 7] ✓ Found vanity address!
  Address: HoCQAnVXBJXcE88ULwqgiGRCqU99649F6UMc5eRZpump
  Private Key: 2ci26xktRZsVc17C1JnMxWFMYuqf4dKQR34o8DjuN9ZctSFnp8Y4iRmXjcLdcnZYrRGsWdY8yNTBhtYUcwiDimci
[Worker 16] ✓ Found vanity address!
  Address: 5emsPvjtMc7cJPp31E4RBoZPsoYv7RNK8ta3zuDApump
  Private Key: 2DEpnfptqDPQboNbQ4ADKAbgELhLS5DBRQECzjVWmTLMhLAi8h3WQpEE7wikEvthUm8L8hFA9zBdJwo7dUdNAFBk
[Worker 9] ✓ Found vanity address!
  Address: 3s6CnmJi5H9MqfYGLbH99MkToSuJ5PDPgcoc7J4Ypump
  Private Key: ARhTM6fnhVSeH9DYRgeUszp6X9LhJfrUGt4cUSyfTYDuWBjnj1QEwyhXaMPK1BJfU6wwNUNfjZMEGsY1VA4qHrv
[Worker 3] ✓ Found vanity address!
  Address: AmPL1tKuovoK5nBq6JWSUWGCh4xZsEDpF9jXrBYepump
  Private Key: 4wurNn1pDRhZ8dm1KJhfHnrec5iZKgg5EjtGtj7c4zu2SbzAnmKymze6DpVzg3AW1gsUBjedALQkiLMjRCDTFJvA
[Worker 10] ✓ Found vanity address!
  Address: EZZH8ZGakrTBuWgC4VSqy99aUCsYecsJJnDwTGhhpump
  Private Key: vanZAnyaLYv7AyizonrhTGH5L66uA1CZU7FazyFN6UUiWYni259WdDJpfbJKCLokRJGZwZf5cgNxE8LKKiuDrgN
[Worker 9] ✓ Found vanity address!
  Address: 3iDSaokkXYb4oWcnyoucASLtmq6h1ppQtg68Fau8pump
  Private Key: 5h6kvNyeSBRWCq2W9N2pe6pH21zNhXktzj6xcbXKA5s4aKLriyVt6XKgYSHnXJ51jXGwWhzS2oSkZsYTQdY5prCe
[Worker 8] ✓ Found vanity address!
  Address: 84TQeiNmsSKixRmaw51dYMdUxbzsDLDpHkrES9jQpump
  Private Key: JEFkNYTNS8f6ZQTsmogqAkgQe44kp96Gy5pwyHhLKxDYgftHAAZyWMqsjr8tnWhwagHNNZBrQaDx4QWGuEbcsHY
[Worker 12] ✓ Found vanity address!
  Address: 9xNnj6YFPDrHGbQ3cmN8tckHeFhp7XcdL8TyNSPHpump
  Private Key: 5rU5mB2LX3mPnRAeDz315nMvkh85xvorRv95Qrq1xSZwYQiKSMYYFqGxUNybDN5yCvqxfW9DXtVSK6JnzSnJmYhL
[Worker 16] ✓ Found vanity address!
  Address: EpChiqdjcoRTS1jnmy2o94Mh3mhfw2UF9MbM5yoLpump
  Private Key: 3P7RhfSk4NV6wgNPrqvxndRJjv5xYyi7YgTsApNtLyHb9ahRCJ1VpXq344Q9SXYQAsjqsY6JsPnfzErs6BCWfNKQ
[Worker 12] ✓ Found vanity address!
  Address: 7PQkhcFwji9CFMwRjt5TcQdH3n2Jgv8NUJckzvMQpump
  Private Key: 43V4r7qtBrBofpyJEcw1b4RBnzNbFm23HRZCQEaYuMjSkbfeF4o1NowFN7iVSMsqf2KS9x5fBEYRgak6DtFzAYE
[Worker 15] ✓ Found vanity address!
  Address: 5qmdHidoXNGrYC1CFQWH695VFsT1ECZ254VRyqMcpump
  Private Key: 2MVxyvSvFLYHt1UW8anXh81wzCkJ34BoGXAQfb3vHqPAHNGkMeT45tPkXug7JESgkG4BscwKEFx8QxodUwYZ5fEv
[Worker 20] ✓ Found vanity address!
  Address: GmvC4t1Y4PnfJmpP2Eod9JUqi22snskH42DjSAympump
  Private Key: F6aAf6dFHkxk2MtQQYL3pNJNYQJmqcMqJ6Chuj53coq6WnLaiAuGXaRsRzkgckEawnRhktQo9B4fBLc7ZyuZVAN
[Worker 15] ✓ Found vanity address!
  Address: 7uGqi1BDNCtDHperTLR96CK9LDwjcQbj59V7xL2vpump
  Private Key: befdJrqyGXTkNNE7SdBLeMBwPDxn4fh9UPZ5uw2pUfM96AVpWynXFYhcFNAiqmVHGWpN61XR2ABocai6CqGfQf8
[Worker 3] ✓ Found vanity address!
  Address: 99kV3wWXhpmXQviqqHbkyfoCUH14iFKEiwMTNdFppump
  Private Key: 3kHWrZumqqLLu1vbUEPCfwLoS7KtUtrCYvCyV7NxEeQvTXadk9QJHJHcvxf2QCpTeudPAzw4K7S5NuPSCARZ1PKL
[Worker 18] ✓ Found vanity address!
  Address: E34U4JLJK7nk6L1vPYxLgWfdZfxTtQQFjMFi726Apump
  Private Key: cHb423bVUWXpZ3smTRpWVYEbLiRsnLuDsuZ2duSSFPHcnzb6zy6VAYYZS5Pu8fXhbsdEFMjXFTBeHzESfaBuuJv
[Worker 14] ✓ Found vanity address!
  Address: DCW7sJfjtA67ne4YQfJv1npsxEW166qGYrnFDoUupump
  Private Key: yNcCYJoz4Vb4mpEmHQqHVuR8ay5rMUpBusTGWzVizyYDusNV77Jgn9KTWXiG3Xzi5LdNUDMnN7b6ob2KJ21p39Y
[Worker 6] ✓ Found vanity address!
  Address: 7kG8oPMDFMB3C493NAD4GtatVTk4Mw8nGfzH1DqApump
  Private Key: 5YF86BEDMfumvWPxKeyMcAMhD5eanHjCgMznPqaGnc6ywTkw7XwezUmXtTiDR45wCTx2hD7MMBvzTLmPTPSW8Dp2
[Worker 17] ✓ Found vanity address!
  Address: CpxCrLQxtLMnRTRyJtFeaoC7nd5Mkx1WPq7hT9iupump
  Private Key: 3ya4B37F365Stqptxh8j1w7NM5DGLT6x3EP7ySueyLjLcsW2NJbYpnh9F3cPaEgvqguZkJJaMexS1bGVdJznqDbU
[Worker 1] ✓ Found vanity address!
  Address: GPcjZD8ATvUDXvJLbRtyFqLXEQLXWX7Sw2KTursZpump
  Private Key: 33XhBiw7J2EyE8qY3vXXmnAEy1hUqcrsbkgLFdAxesZdQ9oDPpeDjNC2jCTZ7YCJm9cu8QV41VqZvKBFCt7aA7P4
[Worker 3] ✓ Found vanity address!
  Address: 6cRZTMG3WztEZ5R85jkAzNDf9T3nZm3KYAW9VohEpump
  Private Key: 3ZWEBeRbtdppEQXCcL6ek43Y458GCB6CZ2qJbJmomPDYVdeAXFSxU1UuYDorSkpbTi1SQeKinP3MrdFdnw2LycMU`;

// Parse addresses from logs
const addresses = [];
const lines = fullLogText.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('Address:')) {
    const addr = lines[i].split('Address:')[1].trim();
    if (i + 1 < lines.length && lines[i + 1].includes('Private Key:')) {
      const privKey = lines[i + 1].split('Private Key:')[1].trim();
      addresses.push({ address: addr, privateKey: privKey });
    }
  }
}

console.log(`Found ${addresses.length} addresses in logs`);

// Read existing pump-addresses.json
const pumpAddressesPath = path.join(__dirname, '..', 'keys', 'pump-addresses.json');
let existingAddresses = [];
if (fs.existsSync(pumpAddressesPath)) {
  existingAddresses = JSON.parse(fs.readFileSync(pumpAddressesPath, 'utf8'));
  console.log(`Loaded ${existingAddresses.length} existing addresses`);
}

// Create a set of existing addresses (case-insensitive)
const existingAddressSet = new Set(
  existingAddresses.map(a => a.publicKey.toLowerCase())
);

// Add new addresses (normalize to lowercase for comparison, but keep original case)
const newAddresses = [];
for (const addr of addresses) {
  const normalizedAddr = addr.address.toLowerCase();
  if (!existingAddressSet.has(normalizedAddr)) {
    // Normalize the address ending to 'pump' (lowercase) for consistency
    const normalizedPublicKey = addr.address.slice(0, -4) + 'pump';
    
    newAddresses.push({
      publicKey: normalizedPublicKey,
      privateKey: addr.privateKey,
      suffix: 'pump',
      source: 'Vanity generator (extracted from logs)',
      status: 'available',
      used: false
    });
    existingAddressSet.add(normalizedAddr);
  }
}

console.log(`Adding ${newAddresses.length} new addresses`);

// Combine and save
const allAddresses = [...existingAddresses, ...newAddresses];
fs.writeFileSync(pumpAddressesPath, JSON.stringify(allAddresses, null, 2));

console.log(`✅ Saved ${allAddresses.length} total addresses to pump-addresses.json`);
console.log(`   - ${existingAddresses.length} existing`);
console.log(`   - ${newAddresses.length} newly added`);
