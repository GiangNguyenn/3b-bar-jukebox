// import axios from "axios";
// import NextAuth from "next-auth";

// const SPOTIFY_REFRESH_TOKEN_URL = "https://accounts.spotify.com/api/token";
// const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID ?? "";
// const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET ?? "";

// async function refreshAccessToken(): Promise<string> {
//   try {
//     console.log("Refreshing access token...");
//     const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString(
//       "base64"
//     );
//     const { data } = await axios.post(
//       SPOTIFY_REFRESH_TOKEN_URL,
//       "grant_type=client_credentials",
//       {
//         headers: {
//           Authorization: `Basic ${basicAuth}`,
//           "Content-Type": "application/x-www-form-urlencoded",
//         },
//       }
//     );
//     return data.access_token;
//   } catch (error) {
//     throw new Error("Error refreshing access token: " + error);
//   }
// }

// const handler = NextAuth({
//   providers: [],
//   callbacks: {
//     async jwt({ token }) {
//       if (token) {
//         return token;
//       }

//       const accessToken = await refreshAccessToken();

//       return {
//         accessToken,
//       };
//     },
//     async session({ session, token }) {
//       session.accessToken = token.accessToken;
//       return session;
//     },
//   },
// });

// export { handler as GET, handler as POST };
