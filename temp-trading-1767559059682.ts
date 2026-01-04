import { buyTokenSimple } from './trading-terminal';

const args = ["5xpPmKnZYmQvHfmq8bv9bGBwKdcb39Ft5yLv3uc62YohZ4ceoz55cKtJa2QPvUVjSRJwJA82H3SvqNmm2y6om1EQ","9Hkr9oca7tExUmJteQ1rSFuKqFmvf93Edx6T59QYpump",1.3,null,true,"low"];
buyTokenSimple(...args)
  .then((r) => {
    console.log('RESULT:' + JSON.stringify(r));
    process.exit(0);
  })
  .catch((e) => {
    console.error('ERROR:', e.message);
    process.exit(1);
  });
