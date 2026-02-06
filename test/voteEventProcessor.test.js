const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

describe('voteEventProcessor', () => {
  let dbStub;
  let cryptoStub;
  let clientStub;
  let processVoteEvent;

  beforeEach(() => {
    dbStub = {
      getVoteEvent: sinon.stub(),
      updateVoteEventStatus: sinon.stub().resolves(),
      getVoteEventParticipants: sinon.stub(),
      getVoteResults: sinon.stub().resolves([]),
      getVoteEventImages: sinon.stub().resolves([]),
      setVoteEventWinners: sinon.stub().resolves(),
      getGuildWallet: sinon.stub(),
      getUser: sinon.stub(),
      recordTransaction: sinon.stub().resolves()
    };

    cryptoStub = {
      sendSol: sinon.stub().resolves({ success: true, signature: 'FAKE_SIG' })
    };

    clientStub = {
      channels: {
        fetch: sinon.stub().resolves({ send: sinon.stub().resolves() })
      }
    };

    // Load processor with stubs
    const mod = proxyquire('../utils/voteEventProcessor', {
      './db': dbStub,
      './crypto': cryptoStub
    });

    processVoteEvent = mod.processVoteEvent;
  });

  it('processes event with owner favorite and pays winners', async () => {
    // Arrange
    const eventId = 123;
    dbStub.getVoteEvent.resolves({ id: eventId, guild_id: 'G1', title: 'Photo Fun', owner_favorite_image_id: 'IMG-1', prize_amount: 4, currency: 'SOL', min_participants: 1, channel_id: 'C1', status: 'active' });
    dbStub.getVoteEventParticipants.resolves([
      { user_id: 'U1', voted_image_id: 'IMG-1' },
      { user_id: 'U2', voted_image_id: 'IMG-1' }
    ]);
    dbStub.getGuildWallet.resolves({ wallet_address: 'GWALLET' });
    dbStub.getUser.withArgs('U1').resolves({ solana_address: 'ADDR1' });
    dbStub.getUser.withArgs('U2').resolves({ solana_address: 'ADDR2' });

    // Act
    await processVoteEvent(eventId, clientStub, 'test');

    // Assert: winners were set
    expect(dbStub.setVoteEventWinners.calledOnce).to.be.true;
    // Assert: payments attempted for both winners
    expect(cryptoStub.sendSol.calledTwice).to.be.true;
    expect(cryptoStub.sendSol.firstCall.args[0]).to.equal('ADDR1');
    expect(cryptoStub.sendSol.secondCall.args[0]).to.equal('ADDR2');
    // Assert: recorded transactions equal number of successful payments
    expect(dbStub.recordTransaction.calledTwice).to.be.true;
  });

  it('cancels event if min participants not met', async () => {
    const eventId = 200;
    dbStub.getVoteEvent.resolves({ id: eventId, guild_id: 'G1', title: 'Small Event', owner_favorite_image_id: null, prize_amount: 1, currency: 'SOL', min_participants: 3, channel_id: 'C1', status: 'active' });
    dbStub.getVoteEventParticipants.resolves([{ user_id: 'U1', voted_image_id: null }]);

    await processVoteEvent(eventId, clientStub, 'test');

    // It should update status to cancelled (inside function flow)
    expect(dbStub.updateVoteEventStatus.called).to.be.true;
    // No payments attempted
    expect(cryptoStub.sendSol.notCalled).to.be.true;
  });
});
