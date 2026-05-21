import { describe, it, expect } from 'vitest';
import { calculateFitScore, LeadInput, CampaignInput } from '../../src/domain/fit-score.js';
import { Profession } from '@prisma/client';

describe('Fit Score Calculation Algorithm', () => {
  const defaultTenant = {
    highValueAreas: ['Redentora', 'Nova Redentora', 'Centro'],
  };

  const defaultCampaign: CampaignInput = {
    profession: Profession.DOCTOR,
    filters: { min_fit_score: 6.0 },
  };

  it('should calculate perfect score (10.0) when all positive criteria match', () => {
    const lead: LeadInput = {
      profession: Profession.DOCTOR,
      whatsappValid: true,
      partnerOrOwner: true,
      yearsOfPractice: 5, // normalized to 1.0
      googleRating: 4.8,
      googleReviewsCount: 15,
      address: { neighborhood: 'Redentora' },
    };

    const score = calculateFitScore(lead, defaultCampaign, defaultTenant);

    // 3.0 (profession) + 2.0 (whatsapp) + 2.0 (owner) + 1.0 (neighborhood) + 1.0 (cnpj_age) + 1.0 (rating) = 10.0
    expect(score).toBe(10.0);
  });

  it('should return 0.0 or capped score when profession does not match and penalty of -5.0 applies', () => {
    const lead: LeadInput = {
      profession: Profession.LAWYER, // mismatch
      whatsappValid: true, // +2.0
      partnerOrOwner: true, // +2.0
      yearsOfPractice: 5, // +1.0
      googleRating: 4.8,
      googleReviewsCount: 15, // +1.0
      address: { neighborhood: 'Redentora' }, // +1.0
    };

    const score = calculateFitScore(lead, defaultCampaign, defaultTenant);

    // -5.0 (mismatch) + 2.0 (whatsapp) + 2.0 (owner) + 1.0 (neighborhood) + 1.0 (cnpj_age) + 1.0 (rating) = 2.0
    expect(score).toBe(2.0);
  });

  it('should correctly normalise CNPJ age score (0 to 1.0 linearly up to 5 years)', () => {
    const leadShort: LeadInput = {
      profession: Profession.DOCTOR, // +3.0
      yearsOfPractice: 2, // 2 / 5 = 0.4
    };
    const scoreShort = calculateFitScore(leadShort, defaultCampaign, defaultTenant);
    expect(scoreShort).toBeCloseTo(3.4, 1);

    const leadLong: LeadInput = {
      profession: Profession.DOCTOR, // +3.0
      yearsOfPractice: 10, // Max 1.0
    };
    const scoreLong = calculateFitScore(leadLong, defaultCampaign, defaultTenant);
    expect(scoreLong).toBe(4.0);
  });

  it('should apply high rating bonus of +1.0 only if rating >= 4.5 AND reviews >= 10', () => {
    const leadLowRating: LeadInput = {
      profession: Profession.DOCTOR, // +3.0
      googleRating: 4.2, // low rating
      googleReviewsCount: 50,
    };
    expect(calculateFitScore(leadLowRating, defaultCampaign, defaultTenant)).toBe(3.0);

    const leadLowReviews: LeadInput = {
      profession: Profession.DOCTOR, // +3.0
      googleRating: 4.9,
      googleReviewsCount: 5, // too few reviews
    };
    expect(calculateFitScore(leadLowReviews, defaultCampaign, defaultTenant)).toBe(3.0);

    const leadGood: LeadInput = {
      profession: Profession.DOCTOR, // +3.0
      googleRating: 4.5,
      googleReviewsCount: 10,
    };
    expect(calculateFitScore(leadGood, defaultCampaign, defaultTenant)).toBe(4.0);
  });

  it('should return -Infinity (skip) for any critical penalties', () => {
    const leadApproached: LeadInput = {
      profession: Profession.DOCTOR,
      alreadyApproachedLast90Days: true,
    };
    expect(calculateFitScore(leadApproached, defaultCampaign, defaultTenant)).toBe(-Infinity);

    const leadClient: LeadInput = {
      profession: Profession.DOCTOR,
      isActiveClient: true,
    };
    expect(calculateFitScore(leadClient, defaultCampaign, defaultTenant)).toBe(-Infinity);

    const leadOptout: LeadInput = {
      profession: Profession.DOCTOR,
      isOptout: true,
    };
    expect(calculateFitScore(leadOptout, defaultCampaign, defaultTenant)).toBe(-Infinity);
  });

  it('should handle edge cases: missing profession, whatsapp, address, ratings', () => {
    const leadEmpty: LeadInput = {};
    const score = calculateFitScore(leadEmpty, defaultCampaign, defaultTenant);
    
    // Mismatch penalty (-5.0) capped at 0.0
    expect(score).toBe(0.0);
  });
});
