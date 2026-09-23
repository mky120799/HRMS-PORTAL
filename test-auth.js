const axios = require('axios');

async function test() {
  try {
    const res = await axios.post('http://localhost:3000/api/v1/auth/signup', {
      tenantName: "Test Corp 4",
      name: "Dave Test",
      email: "dave@testcorp4.test",
      password: "password123"
    });
    
    console.log("res.data keys:", Object.keys(res.data));
    console.log("res.data.data keys:", res.data.data ? Object.keys(res.data.data) : 'undefined');
    
    const authDataToSave = res.data?.data ?? res.data;
    console.log("Saved auth keys:", Object.keys(authDataToSave));
    console.log("Has accessToken:", !!authDataToSave.accessToken);
    
    // Now try to call seed-demo WITH a body to avoid 400
    try {
      const seedRes = await axios.post('http://localhost:3000/api/v1/tenants/seed-demo', {}, {
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
