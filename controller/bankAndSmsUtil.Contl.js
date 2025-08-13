const { default: axios } = require("axios");




const nigerianBanksCache = null;
let banksCacheExpiry = null;


// Korapay API configuration
const KorapayApi = axios.create({
    baseURL: 'https://api.korapay.com/merchant/api/v1',
    headers:{
        'Authorization': `Bearer ${process.env.kora_key}`,
        "Content-Type": 'application/json'
    }
});

const fetchNigerianBanks = async(forceRefresh = false) => {
    try {

    // Check cache first (refresh daily)
    const now = new Date();
    if (!forceRefresh && nigerianBanksCache && banksCacheExpiry && now < banksCacheExpiry) {
      return nigerianBanksCache;
    }

    const response = await KorapayApi.get('/misc/banks?countryCode=NG')

    if (response.data.status && response.data.data) {
      const banks = response.data.data.map(bank => ({
        name: bank.name,
        code: bank.code,
        slug: bank.slug || bank.code,
        shortCode: generateShortCode(bank.name)
      }));

        // Cache for 24 hours
      nigerianBanksCache = banks;
      banksCacheExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      
      console.log(`Fetched ${banks.length} Nigerian banks`);
      return banks;
    }
    
    throw new Error('Invalid response from Korapay banks API');

    } catch (error) {
        console.error('Failed to fetch banks from Korapay:', error.message);
        // Return fallback banks if API fails
        return getFallbackBanks();
    }
}

module.exports = {
    fetchNigerianBanks
}