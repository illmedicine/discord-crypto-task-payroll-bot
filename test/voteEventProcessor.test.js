const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

describe('voteEventProcessor', function () {
  // Allow more time for module loading in CI/Windows UNC environments
  // Note: UNC path + Windows can be slow here; increase timeout
  this.timeout(600000);
  let dbStub;
  let cryptoStub;
  let clientStub;
  let processVoteEvent;
  let walletSyncStub;

  beforeEach(() => {
    dbStub = {
      getVoteEvent: sinon.stub(),
      updateVoteEventStatus: sinon.stub().resolves(),
      getVoteEventParticipants: sinon.stub(),
      getVoteResults: sinon.stub().resolves([]),
      getVoteEventImages: sinon.stub().resolves([
        { image_id: 'IMG-1', image_url: 'http://example.com/1.png', upload_order: 1 },
        { image_id: 'IMG-2', image_url: 'http://example.com/2.png', upload_order: 2 }
      ]),
      setVoteEventWinners: sinon.stub().resolves(),
      getUser: sinon.stub(),
      recordTransaction: sinon.stub().resolves()
    };

    // Fake keypair object with publicKey.toString()
    const fakeKeypair = { publicKey: { toString: () => 'FAKE_PUBKEY' } };

    cryptoStub = {
      getKeypairFromSecret: sinon.stub().returns(fakeKeypair),
      getBalance: sinon.stub().resolves(100), // plenty of SOL
      sendSolFrom: sinon.stub().resolves({ success: true, signature: 'FAKE_SIG' }),
      getSolanaPrice: sinon.stub().resolves(150) // $150/SOL for USD conversion tests
    };

    // Channel send returns a message with an edit method (needed for animation)
    const fakeMsg = { edit: sinon.stub().resolves() };
    const fakeChannel = { send: sinon.stub().resolves(fakeMsg) };
    clientStub = {
      channels: {
        fetch: sinon.stub().resolves(fakeChannel)
      }
    };

    // Stub walletSync so we control the guild wallet returned
    walletSyncStub = {
      getGuildWalletWithFallback: sinon.stub().resolves({
        wallet_address: 'GWALLET',
        wallet_secret: 'FAKE_SECRET_KEY'
      })
    };

    // Load processor with stubbed walletSync
    const mod = proxyquire('../utils/voteEventProcessor', {
      './walletSync': walletSyncStub
    });

    processVoteEvent = mod.processVoteEvent;
  });

  it('processes event with owner favorite and pays winners via treasury', async () => {
    // Arrange
    const eventId = 123;
    dbStub.getVoteEvent.resolves({ id: eventId, guild_id: 'G1', title: 'Photo Fun', owner_favorite_image_id: 'IMG-1', prize_amount: 4, currency: 'SOL', min_participants: 1, channel_id: 'C1', status: 'active' });
    dbStub.getVoteEventParticipants.resolves([
      { user_id: 'U1', voted_image_id: 'IMG-1' },
      { user_id: 'U2', voted_image_id: 'IMG-1' }
    ]);
    dbStub.getUser.withArgs('U1').resolves({ solana_address: 'ADDR1' });
    dbStub.getUser.withArgs('U2').resolves({ solana_address: 'ADDR2' });

    // Act
    console.log('[TEST] Calling processVoteEvent for event', eventId);
    await processVoteEvent(eventId, clientStub, 'test', { db: dbStub, crypto: cryptoStub });
    console.log('[TEST] processVoteEvent returned for event', eventId);

    // Assert: winners were set
    expect(dbStub.setVoteEventWinners.calledOnce).to.be.true;
    // Assert: payments attempted via sendSolFrom (treasury keypair pattern)
    expect(cryptoStub.sendSolFrom.calledTwice).to.be.true;
    expect(cryptoStub.sendSolFrom.firstCall.args[1]).to.equal('ADDR1');
    expect(cryptoStub.sendSolFrom.secondCall.args[1]).to.equal('ADDR2');
    // Assert: recorded transactions equal number of successful payments
    expect(dbStub.recordTransaction.calledTwice).to.be.true;
  });

  it('cancels event if min participants not met', async () => {
    const eventId = 200;
    dbStub.getVoteEvent.resolves({ id: eventId, guild_id: 'G1', title: 'Small Event', owner_favorite_image_id: null, prize_amount: 1, currency: 'SOL', min_participants: 3, channel_id: 'C1', status: 'active' });
    dbStub.getVoteEventParticipants.resolves([{ user_id: 'U1', voted_image_id: null }]);

    await processVoteEvent(eventId, clientStub, 'test', { db: dbStub, crypto: cryptoStub });

    // It should update status to cancelled (inside function flow)
    expect(dbStub.updateVoteEventStatus.called).to.be.true;
    // No payments attempted
    expect(cryptoStub.sendSolFrom.notCalled).to.be.true;
  });

  it('converts USD prize to SOL before paying', async () => {
    const eventId = 300;
    dbStub.getVoteEvent.resolves({ id: eventId, guild_id: 'G1', title: 'USD Event', owner_favorite_image_id: 'IMG-1', prize_amount: 150, currency: 'USD', min_participants: 1, channel_id: 'C1', status: 'active' });
    dbStub.getVoteEventParticipants.resolves([
      { user_id: 'U1', voted_image_id: 'IMG-1' }
    ]);
    dbStub.getUser.withArgs('U1').resolves({ solana_address: 'ADDR1' });

    await processVoteEvent(eventId, clientStub, 'test', { db: dbStub, crypto: cryptoStub });

    // Should have called getSolanaPrice for conversion
    expect(cryptoStub.getSolanaPrice.calledOnce).to.be.true;
    // Payment should be in SOL (150 USD / 150 USD-per-SOL = 1 SOL)
    expect(cryptoStub.sendSolFrom.calledOnce).to.be.true;
    const solAmount = cryptoStub.sendSolFrom.firstCall.args[2];
    expect(solAmount).to.be.closeTo(1.0, 0.01);
  });
});
