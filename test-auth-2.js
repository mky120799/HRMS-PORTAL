const axios = require('axios');

async function test() {
  try {
    const res = await axios.post('http://localhost:3000/api/v1/auth/signup', {
      tenantName: "Test Corp 5",
      name: "Eve Test",
      email: "eve@testcorp5.test",
      password: "password123"
    });
    
    const authDataToSave = res.data?.data ?? res.data;
    
    try {
      const seedRes = await axios.post('http://localhost:3000/api/v1/tenants/seed-demo', undefined, {
        headers: { Authorization: `Bearer ${authDataToSave.accessToken}` }
      });
      console.log("Seed success:", seedRes.data);
    } catch (err) {
      console.log("Seed error status:", err.response?.status);
      console.log("Seed error data:", err.response?.data);
    }
    
  } catch (err) {
    console.log("Signup error:", err.response?.data || err.message);
  }
}

test();
