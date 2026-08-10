import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.nn import RGCNConv


class RGCNDDIModel(nn.Module):
    """
    Final 2-layer R-GCN architecture used for DDI prediction.
    """

    def __init__(
        self,
        num_nodes,
        num_relations,
        embedding_dim=128,
        hidden_dim=128,
        dropout=0.2,
    ):
        super().__init__()

        self.node_embedding = nn.Embedding(
            num_nodes,
            embedding_dim
        )

        self.conv1 = RGCNConv(
            embedding_dim,
            hidden_dim,
            num_relations
        )

        self.conv2 = RGCNConv(
            hidden_dim,
            hidden_dim,
            num_relations
        )

        self.dropout = dropout

        self.ddi_relation = nn.Parameter(
            torch.empty(hidden_dim)
        )

        self.reset_parameters()


    def reset_parameters(self):

        nn.init.xavier_uniform_(
            self.node_embedding.weight
        )

        self.conv1.reset_parameters()
        self.conv2.reset_parameters()

        nn.init.ones_(
            self.ddi_relation
        )


    def encode(
        self,
        edge_index,
        edge_type
    ):

        x = self.node_embedding.weight

        x = self.conv1(
            x,
            edge_index,
            edge_type
        )

        x = F.relu(x)

        x = F.dropout(
            x,
            p=self.dropout,
            training=self.training
        )

        x = self.conv2(
            x,
            edge_index,
            edge_type
        )

        return x


    def decode(
        self,
        z,
        pair_index
    ):

        src = pair_index[0]
        dst = pair_index[1]

        return (
            z[src]
            * self.ddi_relation
            * z[dst]
        ).sum(dim=-1)
