# Freemium Model Plan for JM Bar Jukebox

## Executive Summary

This document outlines a comprehensive freemium model for the JM Bar Jukebox platform, leveraging Stripe as the payment provider. The model is designed to provide value at every tier while encouraging upgrades through feature differentiation and usage limits.

## Current State Analysis

### Existing Features

- **Authentication**: Spotify OAuth integration with premium verification
- **Core Jukebox**: Queue management, track suggestions, playback controls
- **Branding**: Customizable venue branding (logos, colors, typography)
- **Analytics**: Track popularity, release year histograms, suggestion tracking
- **Admin Dashboard**: Health monitoring, device management, recovery systems
- **Public Pages**: Shareable jukebox URLs with custom branding

### Current Premium Model

- Currently requires Spotify Premium accounts
- No internal subscription system
- All features available to authenticated premium users

## Proposed Freemium Model

### Tier Structure

#### 🆓 **Free Tier**

**Target**: Small venues, bars, cafes, personal use
**Price**: $0

**Features**:

- Basic jukebox functionality (queue management only)
- Public jukebox URL
- 10 active devices limit for playlist page
- Standard support

**Limitations**:

- No track suggestions
- No branding customization
- No track suggestion customization
- No analytics
- No custom domain
- No priority support
- No advanced features

#### 💎 **Premium Tier**

**Target**: Medium to large venues, restaurants, event spaces
**Payment Options**:

- **Monthly**: $5/month
- **Lifetime**: $99 (one-time payment)

**Features**:

- Everything in Free tier
- Advanced branding customization
- Custom domain support
- Enhanced analytics (1 year history)
- Unlimited device connections
- Unlimited track suggestions
- Priority email support
- Advanced track suggestion algorithms
- Bulk playlist management
- Recovery system access
- White-label options
- API access
- Custom integrations
- Advanced security features

## Feature Matrix

| Feature                      | Free     | Premium   |
| ---------------------------- | -------- | --------- |
| **Core Jukebox**             |
| Queue Management             | ✅       | ✅        |
| Track Suggestions            | ❌       | ✅        |
| Playback Controls            | ✅       | ✅        |
| **Branding & Customization** |
| Basic Branding               | ❌       | ✅        |
| Advanced Branding            | ❌       | ✅        |
| White-label                  | ❌       | ✅        |
| **Analytics**                |
| Basic Analytics              | ❌       | ✅        |
| Advanced Analytics           | ❌       | ✅        |
| Custom Reports               | ❌       | ✅        |
| **Device Management**        |
| Active Devices               | 10       | Unlimited |
| **Support**                  |
| Email Support                | Standard | Priority  |
| Response Time                | ❌       | ✅        |

## Technical Implementation Plan

### Phase 1: Foundation (Weeks 1-2)

1. **Database Schema Updates**

   ```sql
   -- Add subscription management tables
       CREATE TABLE subscriptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      profile_id uuid REFERENCES profiles(id),
      stripe_subscription_id text UNIQUE,
      stripe_customer_id text,
      plan_type text NOT NULL, -- 'free', 'premium'
      payment_type text NOT NULL, -- 'monthly', 'lifetime'
      status text NOT NULL, -- 'active', 'canceled', 'past_due', 'trialing'
      current_period_start timestamp with time zone,
      current_period_end timestamp with time zone,
      created_at timestamp with time zone DEFAULT now(),
      updated_at timestamp with time zone DEFAULT now()
    );




   ```

2. **Stripe Integration Setup**
   - Configure Stripe webhooks
   - Set up product catalog
   - Implement customer management
   - Create subscription management service

### Phase 2: Core Subscription System (Weeks 3-4)

1. **Subscription Management**

   - User registration flow
   - Plan selection interface
   - Payment processing
   - Subscription status tracking

2. **Feature Gating**
   - Implement tier-based access control

### Phase 3: Feature Implementation (Weeks 5-8)

1. **Free Tier Features**

   - Implement device limits (10 devices only)
   - Disable track suggestions completely
   - Disable branding customization
   - Disable analytics access
   - Create upgrade prompts

2. **Premium Tier Features**
   - Advanced branding options
   - Custom domain support
   - Enhanced analytics
   - Priority support system
   - API access
   - White-label options
   - Custom integrations

## Database Schema Changes

### New Tables Required

```sql
-- Subscription management
CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  stripe_subscription_id text UNIQUE,
  stripe_customer_id text,
  plan_type text NOT NULL CHECK (plan_type IN ('free', 'premium')),
  payment_type text NOT NULL CHECK (payment_type IN ('monthly', 'lifetime')),
  status text NOT NULL CHECK (status IN ('active', 'canceled', 'past_due', 'trialing', 'incomplete')),
  current_period_start timestamp with time zone,
  current_period_end timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
```

### Updated Existing Tables

```sql
-- Add subscription-related fields to profiles table
ALTER TABLE profiles ADD COLUMN subscription_id uuid REFERENCES subscriptions(id);
ALTER TABLE profiles ADD COLUMN plan_type text DEFAULT 'free';
```

## API Endpoints

### New API Routes Required

```
/api/subscriptions/
├── create
├── [id]/
│   ├── route.ts (GET, PUT, DELETE)
│   ├── cancel/
│   └── reactivate/
├── webhook/
└── plans/




```

## Frontend Components

### New Components Required

```
components/
├── billing/
│   ├── PlanSelector.tsx
│   ├── SubscriptionStatus.tsx
│   └── BillingPortal.tsx
└── upgrade/
    ├── UpgradePrompt.tsx
    ├── FeatureComparison.tsx
    └── TrialBanner.tsx
```

## Pricing Strategy

### Revenue Projections

| Tier               | Price | Target Conversion | Monthly Revenue |
| ------------------ | ----- | ----------------- | --------------- |
| Free               | $0    | 75% of users      | $0              |
| Premium (Monthly)  | $5    | 15% of users      | $0.75/user      |
| Premium (Lifetime) | $99   | 10% of users      | $8.25/user      |

**Total ARPU**: ~$9.00/user/month

### Payment Options Strategy

1. **Monthly Subscription ($5/month)**

   - Very low barrier to entry
   - Recurring revenue
   - Easy to cancel
   - Good for testing the service

2. **Lifetime Payment ($99)**
   - Higher upfront revenue
   - Better for long-term users
   - No churn risk
   - ~20 months break-even point

### Growth Strategy

1. **Freemium Conversion**

   - Usage-based upgrade prompts
   - Feature limitation triggers
   - Trial periods for premium features
   - Clear value proposition for lifetime option

2. **Retention**

   - Regular feature updates
   - Usage analytics for users
   - Personalized upgrade recommendations
   - Lifetime users get early access to new features

3. **Expansion**
   - Add-on services (custom integrations, consulting)
   - Volume discounts for multiple venues
   - Special pricing for lifetime users upgrading

## Implementation Timeline

### Month 1: Foundation

- Week 1-2: Database schema and Stripe setup
- Week 3-4: Basic subscription system

### Month 2: Core Features

- Week 1-2: Feature gating and usage tracking
- Week 3-4: Free tier implementation

### Month 3: Premium Features

- Week 1-2: Premium tier features
- Week 3-4: Payment options (monthly/lifetime)

### Month 4: Polish & Launch

- Week 1-2: Testing and optimization
- Week 3-4: Launch preparation and go-live

## Risk Mitigation

### Technical Risks

- **Stripe Integration**: Use official SDKs and webhook verification
- **Data Migration**: Implement gradual migration strategy
- **Performance**: Monitor usage patterns and optimize accordingly

### Business Risks

- **Churn**: Implement usage analytics to identify at-risk users
- **Competition**: Focus on unique features and superior UX
- **Pricing**: Start conservative and adjust based on market response

## Success Metrics

### Key Performance Indicators

- **Conversion Rate**: Free to paid conversion
- **Churn Rate**: Monthly subscription cancellations
- **ARPU**: Average revenue per user
- **LTV**: Customer lifetime value
- **Feature Usage**: Adoption of premium features

### Technical Metrics

- **API Performance**: Response times under load
- **Error Rates**: Payment processing success rates
- **Uptime**: Service availability
- **Support Tickets**: Volume and resolution time

## Next Steps

1. **Immediate Actions**

   - Set up Stripe account and test environment
   - Create database migration scripts
   - Design subscription flow wireframes

2. **Development Priorities**

   - Implement core subscription system
   - Add tier-based access control

3. **Marketing Preparation**
   - Design pricing page
   - Create feature comparison matrix
   - Prepare upgrade messaging

This freemium model provides a clear path for monetization while maintaining value for all users. The tiered approach allows for natural progression as users' needs grow, while the technical implementation ensures scalability and reliability.
